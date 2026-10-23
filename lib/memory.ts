import { and, asc, eq, isNull, or, sql } from "drizzle-orm"

import { db } from "@/db"
import { memories, memoryInputSchema, type MemoryScope } from "@/db/schema"

// Per-agent notes and shared notes have separate prompt budgets. Newest notes
// win inside each budget; anything past it stays in the database and is
// reachable with memory_search.
export const AGENT_MEMORY_BUDGET = 12_000
export const SHARED_MEMORY_BUDGET = 3_000
export const MEMORY_SEARCH_LIMIT = 10

export const SHARED_WRITE_ERROR =
  "Shared notes can only be created, edited, or deleted by the person in the Memory panel. You can save a note of your own instead."

export const SHARED_FORGET_ERROR =
  "Shared notes can only be deleted by the person in the Memory panel."

export type MemoryMatch = {
  id: string
  scope: MemoryScope
  age: string
  text: string
}

type Note = { id: string; content: string; createdAt: Date }

// A literal LIKE pattern: %, _ and \ in the query match themselves.
function escapeLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

export function formatMemoryAge(createdAt: Date, now: Date) {
  const elapsed = Math.max(0, now.getTime() - createdAt.getTime())
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return "just now"
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`
  return `${Math.floor(elapsed / day)}d`
}

// Higher is a closer match. The query is one substring, not a token list.
function rankContent(content: string, needle: string) {
  const hay = content.toLowerCase()
  if (hay === needle) return 3
  if (hay.startsWith(needle)) return 2
  if (hay.includes(needle)) return 1
  return 0
}

export function searchMemories(agentId: string, query: string, now = new Date()) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const pattern = `%${escapeLike(query.trim())}%`
  const rows = db
    .select({
      id: memories.id,
      agentId: memories.agentId,
      content: memories.content,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(
      and(
        or(eq(memories.agentId, agentId), isNull(memories.agentId)),
        sql`lower(${memories.content}) like lower(${pattern}) escape '\\'`
      )
    )
    .all()

  return rows
    .map((row) => ({ row, rank: rankContent(row.content, needle) }))
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank
      const byTime = b.row.createdAt.getTime() - a.row.createdAt.getTime()
      if (byTime !== 0) return byTime
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0
    })
    .slice(0, MEMORY_SEARCH_LIMIT)
    .map(({ row }): MemoryMatch => ({
      id: row.id,
      scope: row.agentId ? "agent" : "shared",
      age: formatMemoryAge(row.createdAt, now),
      text: row.content,
    }))
}

function fitNotes(notes: Note[], budget: number, empty: string) {
  if (notes.length === 0) return empty

  // Newest notes win when the budget runs out. Older ones stay searchable.
  const lines: string[] = []
  let used = 0
  for (const note of [...notes].reverse()) {
    const line = `- [${note.id}] ${note.content}`
    if (used + line.length > budget) break
    lines.unshift(line)
    used += line.length
  }
  const dropped = notes.length - lines.length
  const hidden =
    dropped === 1
      ? "(1 older note is not shown. Use memory_search to read it.)"
      : dropped > 1
        ? `(${dropped} older notes are not shown. Use memory_search to read them.)`
        : null
  return [hidden, lines.join("\n")].filter(Boolean).join("\n")
}

function ownNotes(agentId: string) {
  return db
    .select({ id: memories.id, content: memories.content, createdAt: memories.createdAt })
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(asc(memories.createdAt))
    .all()
}

function sharedNotes() {
  return db
    .select({ id: memories.id, content: memories.content, createdAt: memories.createdAt })
    .from(memories)
    .where(isNull(memories.agentId))
    .orderBy(asc(memories.createdAt))
    .all()
}

// The two blocks are budgeted separately so a full agent memory cannot push
// shared notes out, and shared notes cannot push an agent's own notes out.
export function memoryPrompt(agentId: string) {
  return [
    "## Your notes",
    fitNotes(
      ownNotes(agentId),
      AGENT_MEMORY_BUDGET,
      "Your memory is empty. Nothing has been saved yet."
    ),
    "",
    "## Shared notes",
    "The person wrote these for every agent. You can read and search them. You cannot create, edit, or delete them; only the person can, from the Memory panel.",
    fitNotes(sharedNotes(), SHARED_MEMORY_BUDGET, "No shared notes yet."),
  ].join("\n")
}

// Agent tool path. Scope "shared" is refused so one agent cannot write a note
// that is injected into every other agent's prompt.
export function saveAgentNote(agentId: string, note: string, scope?: MemoryScope) {
  if (scope === "shared") throw new Error(SHARED_WRITE_ERROR)
  const content = note.trim()
  if (!content) throw new Error("Write something to remember.")
  if (content.length > 2000) throw new Error("Keep a note under 2000 characters.")
  const [row] = db
    .insert(memories)
    .values({ agentId, content })
    .returning({ id: memories.id })
    .all()
  return { id: row.id, saved: content }
}

export function forgetAgentNote(agentId: string, id: string) {
  const removed = db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.agentId, agentId)))
    .returning({ id: memories.id })
    .all()
  if (removed.length > 0) return { forgotten: id }

  const note = db
    .select({ agentId: memories.agentId })
    .from(memories)
    .where(eq(memories.id, id))
    .get()
  if (note?.agentId === null) throw new Error(SHARED_FORGET_ERROR)
  throw new Error(`No note with id ${id} in your memory.`)
}

// Owner path, used by the Memory panel server actions. Not used by agent tools.
export function addOwnerNote(
  agentId: string,
  content: string,
  scope: MemoryScope = "agent"
) {
  const data = memoryInputSchema.parse({ content, scope })
  db.insert(memories)
    .values({
      agentId: data.scope === "shared" ? null : agentId,
      content: data.content,
    })
    .run()
}

export function updateOwnerNote(agentId: string, memoryId: string, content: string) {
  const data = memoryInputSchema.parse({ content })
  const note = db
    .select({ agentId: memories.agentId })
    .from(memories)
    .where(eq(memories.id, memoryId))
    .get()
  if (!note || (note.agentId !== null && note.agentId !== agentId)) {
    throw new Error("That note isn't in this memory.")
  }
  db.update(memories)
    .set({ content: data.content })
    .where(eq(memories.id, memoryId))
    .run()
}

export function deleteOwnerNote(agentId: string, memoryId: string) {
  db.delete(memories)
    .where(
      and(
        eq(memories.id, memoryId),
        or(eq(memories.agentId, agentId), isNull(memories.agentId))
      )
    )
    .run()
}

export function clearAgentNotes(agentId: string) {
  db.delete(memories).where(eq(memories.agentId, agentId)).run()
}
