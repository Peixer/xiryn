/**
 * Tests for lib/agent/subturn.ts
 *
 * Covers everything that doesn't need a live LLM or Docker:
 *  1. Constants exported correctly
 *  2. isSubturnThread / activeSubturnThreadIds depth guard
 *  3. runSubturn input validation (empty, whitespace, too long, depth=1)
 *  4. DB schema: ephemeral + parent_thread_id columns exist with correct defaults
 *  5. Sidebar nav filter: ephemeral=true excluded from workspace queries
 *  6. Cleanup: deleting ephemeral thread removes it from DB
 *  7. Orphan cleanup: no ephemeral threads remain in live DB after module load
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { nanoid } from "nanoid"

import type { Agent } from "@/db/schema"

import {
  MAX_TASK_LENGTH,
  MAX_CONCURRENT_PER_AGENT,
  MAX_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  isSubturnThread,
  activeSubturnThreadIds,
  runSubturn,
} from "@/lib/agent/subturn"

const migrationsFolder = path.join(process.cwd(), "db", "migrations")

// ─── Helpers ──────────────────────────────────────────────────────────────────

function openTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-subturn-test-"))
  const sqlite = new Database(path.join(dir, "xiryn.db"))
  sqlite.pragma("foreign_keys = ON")
  const db = drizzle({ client: sqlite, casing: "snake_case" })
  migrate(db, { migrationsFolder })
  return { dir, sqlite, db }
}

function closeTemp(sqlite: Database.Database, dir: string) {
  sqlite.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

function seedAgent(sqlite: Database.Database, suffix = nanoid(6)) {
  const id = nanoid(12)
  sqlite
    .prepare(
      `INSERT INTO agents (id, name, role, instructions, glyph, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      `Agent ${suffix}`,
      "tester",
      "test",
      `glyph-${suffix}`,
      Date.now(),
      Date.now()
    )
  return id
}

function seedThread(
  sqlite: Database.Database,
  opts: { agentId: string; ephemeral?: 0 | 1; parentThreadId?: string }
) {
  const id = nanoid(12)
  sqlite
    .prepare(
      `INSERT INTO threads (id, agent_id, ephemeral, parent_thread_id, title, active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      opts.agentId,
      opts.ephemeral ?? 0,
      opts.parentThreadId ?? null,
      "test",
      Date.now(),
      Date.now()
    )
  return id
}

// ─── 1. Constants ─────────────────────────────────────────────────────────────

test("subturn: MAX_TASK_LENGTH is 4000", () => {
  assert.equal(MAX_TASK_LENGTH, 4_000)
})

test("subturn: MAX_CONCURRENT_PER_AGENT is 3", () => {
  assert.equal(MAX_CONCURRENT_PER_AGENT, 3)
})

test("subturn: MAX_TIMEOUT_MS is 300_000", () => {
  assert.equal(MAX_TIMEOUT_MS, 300_000)
})

test("subturn: DEFAULT_TIMEOUT_MS is 120_000", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 120_000)
})

// ─── 2. Depth guard ───────────────────────────────────────────────────────────

test("subturn: isSubturnThread returns false for unknown id", () => {
  assert.equal(isSubturnThread("not-a-real-thread"), false)
})

test("subturn: isSubturnThread returns false for empty string", () => {
  assert.equal(isSubturnThread(""), false)
})

test("subturn: isSubturnThread returns true after manually adding an id", () => {
  const id = "depth-guard-add-" + nanoid(6)
  activeSubturnThreadIds.add(id)
  try {
    assert.equal(isSubturnThread(id), true)
  } finally {
    activeSubturnThreadIds.delete(id)
  }
})

test("subturn: isSubturnThread returns false after removing an id", () => {
  const id = "depth-guard-remove-" + nanoid(6)
  activeSubturnThreadIds.add(id)
  activeSubturnThreadIds.delete(id)
  assert.equal(isSubturnThread(id), false)
})

// ─── 3. Input validation ──────────────────────────────────────────────────────

const fakeAgent: Agent = {
  id: "fake-agent",
  name: "Fake",
  role: "tester",
  instructions: null,
  model: null,
  glyph: "test",
  workstationId: null,
  category: "general",
  createdAt: new Date(),
  updatedAt: new Date(),
}

test("subturn: rejects empty task string", async () => {
  await assert.rejects(
    () => runSubturn({ task: "", agent: fakeAgent, parentThreadId: "t1" }),
    /must not be empty/i
  )
})

test("subturn: rejects whitespace-only task", async () => {
  await assert.rejects(
    () => runSubturn({ task: "   \n\t  ", agent: fakeAgent, parentThreadId: "t1" }),
    /must not be empty/i
  )
})

test("subturn: rejects task longer than MAX_TASK_LENGTH", async () => {
  await assert.rejects(
    () =>
      runSubturn({
        task: "a".repeat(MAX_TASK_LENGTH + 1),
        agent: fakeAgent,
        parentThreadId: "t1",
      }),
    /exceeds the maximum length/i
  )
})

test("subturn: rejects nested subturn (depth guard — max depth = 1)", async () => {
  const parentId = "subturn-parent-" + nanoid(6)
  activeSubturnThreadIds.add(parentId)
  try {
    await assert.rejects(
      () =>
        runSubturn({ task: "nested task", agent: fakeAgent, parentThreadId: parentId }),
      /max depth = 1/i
    )
  } finally {
    activeSubturnThreadIds.delete(parentId)
  }
})

test("subturn: task at exactly MAX_TASK_LENGTH passes validation (fails at DB level)", async () => {
  const err = await runSubturn({
    task: "x".repeat(MAX_TASK_LENGTH),
    agent: fakeAgent,
    parentThreadId: "t1",
  }).catch((e: Error) => e)
  assert.ok(err instanceof Error, "should throw (no real DB)")
  assert.ok(
    !/exceeds the maximum length/i.test(err.message),
    "should NOT be a validation error — must pass the length check"
  )
})

// ─── 4. DB schema ─────────────────────────────────────────────────────────────

test("subturn: threads table has ephemeral column defaulting to 0", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const threadId = seedThread(sqlite, { agentId })
    const row = sqlite
      .prepare("SELECT ephemeral FROM threads WHERE id = ?")
      .get(threadId) as { ephemeral: number; parent_thread_id: string | null }
    assert.equal(row?.ephemeral, 0, "ephemeral must default to 0 (false)")
  } finally {
    closeTemp(sqlite, dir)
  }
})

test("subturn: threads table has parent_thread_id column defaulting to NULL", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const threadId = seedThread(sqlite, { agentId })
    const row = sqlite
      .prepare("SELECT parent_thread_id FROM threads WHERE id = ?")
      .get(threadId) as { ephemeral: number; parent_thread_id: string | null }
    assert.equal(row?.parent_thread_id, null, "parent_thread_id must default to null")
  } finally {
    closeTemp(sqlite, dir)
  }
})

test("subturn: can insert ephemeral thread with parentThreadId set", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const parentId = seedThread(sqlite, { agentId, ephemeral: 0 })
    const childId = seedThread(sqlite, {
      agentId,
      ephemeral: 1,
      parentThreadId: parentId,
    })
    const child = sqlite
      .prepare("SELECT ephemeral, parent_thread_id FROM threads WHERE id = ?")
      .get(childId) as { ephemeral: number; parent_thread_id: string | null }
    assert.equal(child?.ephemeral, 1, "child must be ephemeral")
    assert.equal(child?.parent_thread_id, parentId, "parent_thread_id must be set")
  } finally {
    closeTemp(sqlite, dir)
  }
})

test("subturn: threads table has both new columns (PRAGMA table_info)", () => {
  const { dir, sqlite } = openTemp()
  try {
    const cols = (
      sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[]
    ).map((c) => c.name)
    assert.ok(cols.includes("ephemeral"), "ephemeral column must exist")
    assert.ok(cols.includes("parent_thread_id"), "parent_thread_id column must exist")
  } finally {
    closeTemp(sqlite, dir)
  }
})

// ─── 5. Sidebar nav filter ────────────────────────────────────────────────────

test("subturn: ephemeral=true threads excluded by WHERE ephemeral = 0", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const normalId = seedThread(sqlite, { agentId, ephemeral: 0 })
    const ephemeralId = seedThread(sqlite, { agentId, ephemeral: 1 })

    const ids = (
      sqlite.prepare("SELECT id FROM threads WHERE ephemeral = 0").all() as {
        id: string
      }[]
    ).map((r) => r.id)

    assert.ok(ids.includes(normalId), "normal thread must appear")
    assert.ok(!ids.includes(ephemeralId), "ephemeral thread must NOT appear")
  } finally {
    closeTemp(sqlite, dir)
  }
})

test("subturn: multiple ephemeral threads all excluded from nav", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const ephemeralIds = [
      seedThread(sqlite, { agentId, ephemeral: 1 }),
      seedThread(sqlite, { agentId, ephemeral: 1 }),
      seedThread(sqlite, { agentId, ephemeral: 1 }),
    ]
    const normalId = seedThread(sqlite, { agentId, ephemeral: 0 })

    const navIds = (
      sqlite.prepare("SELECT id FROM threads WHERE ephemeral = 0").all() as {
        id: string
      }[]
    ).map((r) => r.id)

    assert.ok(navIds.includes(normalId), "normal thread must appear")
    for (const id of ephemeralIds) {
      assert.ok(!navIds.includes(id), `ephemeral thread ${id} must NOT appear in nav`)
    }
  } finally {
    closeTemp(sqlite, dir)
  }
})

// ─── 6. Cleanup ───────────────────────────────────────────────────────────────

test("subturn: DELETE removes ephemeral thread (simulates finally block)", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const threadId = seedThread(sqlite, { agentId, ephemeral: 1 })

    const before = sqlite.prepare("SELECT id FROM threads WHERE id = ?").get(threadId)
    assert.ok(before, "thread must exist before cleanup")

    sqlite.prepare("DELETE FROM threads WHERE id = ?").run(threadId)

    const after = sqlite.prepare("SELECT id FROM threads WHERE id = ?").get(threadId)
    assert.equal(after, undefined, "thread must be gone after cleanup")
  } finally {
    closeTemp(sqlite, dir)
  }
})

test("subturn: bulk DELETE removes all ephemeral threads (simulates startup orphan cleanup)", () => {
  const { dir, sqlite } = openTemp()
  try {
    const agentId = seedAgent(sqlite)
    const ids = [
      seedThread(sqlite, { agentId, ephemeral: 1 }),
      seedThread(sqlite, { agentId, ephemeral: 1 }),
    ]

    const result = sqlite.prepare("DELETE FROM threads WHERE ephemeral = 1").run()
    assert.ok(result.changes >= 2, `expected >= 2 deletions, got ${result.changes}`)

    for (const id of ids) {
      const row = sqlite.prepare("SELECT id FROM threads WHERE id = ?").get(id)
      assert.equal(row, undefined, `orphan ${id} must be deleted`)
    }
  } finally {
    closeTemp(sqlite, dir)
  }
})

// ─── 7. Orphan cleanup (live DB) ──────────────────────────────────────────────

test("subturn: no ephemeral threads remain in live DB after module load", (t) => {
  // subturn.ts runs a cleanup IIFE at module load that deletes all ephemeral=true threads.
  // By the time this test runs the module is already imported above, so orphans are gone.
  const livePath = path.join(process.cwd(), "data", "xiryn.db")
  if (!fs.existsSync(livePath)) {
    t.skip("Live database does not exist")
    return
  }
  const liveRaw = new Database(livePath, { readonly: true, fileMustExist: true })
  try {
    const orphans = liveRaw.prepare("SELECT id FROM threads WHERE ephemeral = 1").all()
    assert.equal(
      orphans.length,
      0,
      `${orphans.length} orphaned ephemeral thread(s) found — cleanup IIFE should have removed them`
    )
  } finally {
    liveRaw.close()
  }
})
