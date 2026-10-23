import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

import Database from "better-sqlite3"

import {
  buildSnippet,
  escapeLike,
  extractMessageText,
  likePattern,
  normalizeQuery,
  SNIPPET_LENGTH,
} from "./search"

const phrase = (label: string) => label

test("extracts user and assistant text and skips tool output", () => {
  const parts = [
    { type: "text", text: "Hello" },
    { type: "text", text: "   " },
    { type: "reasoning", text: "hidden chain of thought" },
    {
      type: "tool-shell",
      toolCallId: "call-1",
      state: "output-available",
      input: { command: "cat ~/.secrets" },
      output: "sk-live-secret-value",
      text: "should not surface",
    },
    { type: "file", filename: "secret.txt", mediaType: "text/plain" },
    { type: "step-start" },
    { type: "text", text: "world" },
  ]

  assert.equal(extractMessageText(parts), "Hello\nworld")
  assert.equal(extractMessageText("nope"), "")
  assert.equal(extractMessageText(null), "")
  assert.equal(extractMessageText([{ type: "text", text: 12 }]), "")
  assert.equal(buildSnippet(extractMessageText(parts), "sk-live-secret-value"), null)
  assert.equal(buildSnippet(extractMessageText(parts), "hidden chain"), null)
})

test("snippet window sits at the start, middle, and end", () => {
  const startMark = phrase("STARTMARK")
  const start = buildSnippet(startMark + "y".repeat(300), startMark)
  assert.ok(start)
  assert.equal(start.text.length, SNIPPET_LENGTH)
  assert.equal(start.matchStart, 0)
  assert.equal(start.text.slice(0, startMark.length), startMark)
  assert.equal(start.leadingEllipsis, false)
  assert.equal(start.trailingEllipsis, true)

  const midMark = phrase("MIDMARK")
  const middle = buildSnippet("a".repeat(200) + midMark + "b".repeat(200), midMark)
  assert.ok(middle)
  assert.equal(middle.text.length, SNIPPET_LENGTH)
  assert.equal(middle.leadingEllipsis, true)
  assert.equal(middle.trailingEllipsis, true)
  assert.equal(middle.matchStart, Math.floor((SNIPPET_LENGTH - midMark.length) / 2))
  assert.equal(middle.text.slice(middle.matchStart, middle.matchEnd), midMark)

  const endMark = phrase("ENDMARK")
  const end = buildSnippet("y".repeat(300) + endMark, "endmark")
  assert.ok(end)
  assert.equal(end.text.length, SNIPPET_LENGTH)
  assert.equal(end.text.endsWith(endMark), true)
  assert.equal(end.matchStart, SNIPPET_LENGTH - endMark.length)
  assert.equal(end.text.slice(end.matchStart, end.matchEnd), endMark)
  assert.equal(end.leadingEllipsis, true)
  assert.equal(end.trailingEllipsis, false)
})

test("snippet keeps short text and collapses whitespace", () => {
  const short = buildSnippet("Hello Orbital", "orbital")
  assert.ok(short)
  assert.equal(short.text, "Hello Orbital")
  assert.equal(short.text.slice(short.matchStart, short.matchEnd), "Orbital")
  assert.equal(short.leadingEllipsis, false)
  assert.equal(short.trailingEllipsis, false)

  const collapsed = buildSnippet("hello\n\nworld", "hello   world")
  assert.equal(collapsed?.text, "hello world")
  assert.equal(collapsed?.matchStart, 0)
  assert.equal(buildSnippet("hello world", "missing"), null)
})

test("escapes LIKE wildcards and the escape character", () => {
  assert.equal(escapeLike("100%_done"), "100\\%\\_done")
  assert.equal(escapeLike("a\\b%"), "a\\\\b\\%")
  assert.equal(likePattern("a_b"), "%a\\_b%")

  const db = new Database(":memory:")
  db.exec("create table messages (parts text)")
  const insert = db.prepare("insert into messages (parts) values (?)")
  insert.run("100%_done")
  insert.run("1000 done")
  insert.run("100Xdone")
  insert.run("a\\b%")
  const matches = (query: string) =>
    db
      .prepare("select parts from messages where parts like ? escape '\\'")
      .all(likePattern(query)) as { parts: string }[]

  assert.deepEqual(
    matches("100%_done").map((row) => row.parts),
    ["100%_done"]
  )
  assert.deepEqual(
    matches("a\\b%").map((row) => row.parts),
    ["a\\b%"]
  )
  db.close()
})

test("rejects empty and too-short queries", () => {
  assert.equal(normalizeQuery(""), null)
  assert.equal(normalizeQuery("   "), null)
  assert.equal(normalizeQuery("a"), null)
  assert.equal(normalizeQuery(" a "), null)
  assert.equal(normalizeQuery("ab"), "ab")
  assert.equal(normalizeQuery("  Ab  "), "Ab")
})

// A throwaway database: the real schema, nothing of the user's.
process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-search-"))

const { sqlite } = await import("@/db")
const { agents, messages, squads, threads } = await import("@/db/schema")
const { db } = await import("@/db")
const { MAX_RESULTS, searchMessages } = await import("@/queries/search")

after(() => {
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

function makeAgent(name: string) {
  const [agent] = db.insert(agents).values({ name, role: "tester" }).returning().all()
  return agent
}

function makeSquad(name: string) {
  const [squad] = db.insert(squads).values({ name }).returning().all()
  return squad
}

function makeThread(owner: { agentId?: string; squadId?: string }, title: string | null) {
  const [thread] = db
    .insert(threads)
    .values({ ...owner, title })
    .returning()
    .all()
  return thread
}

function say(
  threadId: string,
  id: string,
  parts: unknown[],
  options: { role?: "user" | "assistant" | "system"; createdAt?: Date } = {}
) {
  db.insert(messages)
    .values({
      id,
      threadId,
      role: options.role ?? "user",
      parts,
      ...(options.createdAt && { createdAt: options.createdAt }),
    })
    .run()
}

test("a known phrase finds its thread and skips tool output", () => {
  const agent = makeAgent("Nova")
  const thread = makeThread({ agentId: agent.id }, "Orbital notes")
  say(thread.id, "msg-phrase", [
    { type: "text", text: "The orbital window opens at dawn." },
    {
      type: "tool-shell",
      toolCallId: "call-secret",
      state: "output-available",
      input: { command: "echo" },
      output: "sk-live-do-not-show",
    },
  ])
  say(thread.id, "msg-wild", [{ type: "text", text: "progress is 100%_done today" }])
  say(thread.id, "msg-wild-decoy", [{ type: "text", text: "progress is 100Xdone today" }])
  say(
    thread.id,
    "msg-system",
    [{ type: "text", text: "The orbital window is a system note." }],
    { role: "system" }
  )

  const hits = searchMessages({ query: "ORBITAL WINDOW" })
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.threadId, thread.id)
  assert.equal(hits[0]?.title, "Orbital notes")
  assert.equal(hits[0]?.agentName, "Nova")
  assert.equal(hits[0]?.href, `/a/${agent.id}/${thread.id}`)
  assert.match(hits[0]?.snippet ?? "", /orbital window/i)
  assert.equal((hits[0]?.snippet ?? "").includes("sk-live"), false)
  assert.deepEqual(searchMessages({ query: "sk-live-do-not-show" }), [])
  assert.deepEqual(searchMessages({ query: "toolCallId" }), [])
  assert.deepEqual(searchMessages({ query: "" }), [])
  assert.deepEqual(searchMessages({ query: "z" }), [])

  const wild = searchMessages({ query: "100%_done" })
  assert.deepEqual(
    wild.map((hit) => hit.messageId),
    ["msg-wild"]
  )
})

test("filters by agent or squad and keeps the newest fifty", () => {
  const ada = makeAgent("Ada")
  const grace = makeAgent("Grace")
  const adaThread = makeThread({ agentId: ada.id }, "Ada log")
  const graceThread = makeThread({ agentId: grace.id }, "Grace log")
  say(adaThread.id, "ada-hit", [{ type: "text", text: "shared lunar phrase" }])
  say(graceThread.id, "grace-hit", [{ type: "text", text: "shared lunar phrase" }])

  const adaHits = searchMessages({ query: "shared lunar", agentId: ada.id })
  assert.deepEqual(
    adaHits.map((hit) => hit.messageId),
    ["ada-hit"]
  )
  assert.deepEqual(
    searchMessages({ query: "shared lunar", agentId: grace.id }).map(
      (hit) => hit.threadId
    ),
    [graceThread.id]
  )

  const squad = makeSquad("Night watch")
  const squadThread = makeThread({ squadId: squad.id }, "Watch log")
  say(squadThread.id, "squad-hit", [{ type: "text", text: "shared lunar phrase" }])
  const squadHits = searchMessages({ query: "shared lunar", squadId: squad.id })
  assert.equal(squadHits.length, 1)
  assert.equal(squadHits[0]?.squadName, "Night watch")
  assert.equal(squadHits[0]?.href, `/s/${squad.id}/${squadThread.id}`)

  for (let i = 0; i < 60; i++) {
    say(adaThread.id, `cap-${i}`, [{ type: "text", text: "capacity phrase here" }], {
      createdAt: new Date(1_800_000_000_000 + i),
    })
  }
  const capped = searchMessages({ query: "capacity phrase" })
  assert.equal(capped.length, MAX_RESULTS)
  assert.equal(capped[0]?.messageId, "cap-59")
  assert.equal(capped[MAX_RESULTS - 1]?.messageId, "cap-10")
  assert.equal(
    capped.some((hit) => hit.messageId === "cap-0"),
    false
  )
})

test("ten thousand messages still search in under a second", () => {
  const agent = makeAgent("Bulk")
  const thread = makeThread({ agentId: agent.id }, "Bulk log")
  const insert = sqlite.prepare(
    `insert into messages (id, thread_id, role, parts, metadata, created_at)
     values (?, ?, 'assistant', ?, null, ?)`
  )
  const write = sqlite.transaction((count: number) => {
    for (let i = 0; i < count; i++) {
      const text =
        i === 4242
          ? "unique bulk needle is text content"
          : `filler message ${i} about weather`
      insert.run(
        `bulk-${i}`,
        thread.id,
        JSON.stringify([
          { type: "text", text },
          {
            type: "tool-shell",
            toolCallId: `bulk-tool-${i}`,
            state: "output-available",
            input: { command: "noop" },
            output: "bulk-secret-token",
          },
        ]),
        1_900_000_000_000 + i
      )
    }
  })
  write(10_000)

  const started = performance.now()
  const hits = searchMessages({ query: "text" })
  const elapsed = performance.now() - started

  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.messageId, "bulk-4242")
  assert.equal(hits[0]?.snippet.includes("bulk-secret-token"), false)
  assert.ok(elapsed < 1000, `search took ${elapsed.toFixed(0)}ms`)
  assert.deepEqual(searchMessages({ query: "bulk-secret-token" }), [])
})
