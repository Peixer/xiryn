import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

const migrationsFolder = path.join(process.cwd(), "db", "migrations")

type Journal = { entries: { tag: string; when: number }[] }

function readJournal(): Journal {
  return JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")
  )
}

function openTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-mem-mig-"))
  const sqlite = new Database(path.join(dir, "xiryn.db"))
  sqlite.pragma("foreign_keys = ON")
  const db = drizzle({ client: sqlite, casing: "snake_case" })
  return { dir, sqlite, db }
}

function runFile(sqlite: Database.Database, tag: string) {
  const sqlText = fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), "utf8")
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    const trimmed = statement.trim()
    if (trimmed) sqlite.exec(trimmed)
  }
}

function close(sqlite: Database.Database, dir: string) {
  sqlite.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

test("shared-memory migration applies on an empty database", () => {
  const journal = readJournal()
  const latest = journal.entries[journal.entries.length - 1]
  assert.equal(latest.tag, "0005_shared_memory")

  const { dir, sqlite, db } = openTemp()
  try {
    migrate(db, { migrationsFolder })
    const columns = sqlite.prepare("pragma table_info(memories)").all() as {
      name: string
      notnull: number
    }[]
    const agentId = columns.find((column) => column.name === "agent_id")
    assert.ok(agentId)
    assert.equal(agentId.notnull, 0)

    sqlite
      .prepare(
        "insert into agents (id, name, role, glyph, created_at, updated_at) values ('agt', 'A', 'role', 'glyph', 1, 1)"
      )
      .run()
    sqlite
      .prepare(
        "insert into memories (id, agent_id, content, created_at) values ('shared', null, 'for everyone', 2)"
      )
      .run()
    const row = sqlite.prepare("select agent_id as agentId, content from memories").get()
    assert.deepEqual(row, { agentId: null, content: "for everyone" })
  } finally {
    close(sqlite, dir)
  }
})

test("shared-memory migration keeps notes already stored on a populated database", () => {
  const journal = readJournal()
  const prior = journal.entries.slice(0, -1)
  assert.ok(prior.length >= 1)
  assert.equal(journal.entries[journal.entries.length - 1].tag, "0005_shared_memory")

  const { dir, sqlite, db } = openTemp()
  try {
    for (const entry of prior) runFile(sqlite, entry.tag)
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`)
    const previous = prior[prior.length - 1]
    sqlite
      .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
      .run("prior", previous.when)

    sqlite
      .prepare(
        "insert into agents (id, name, role, glyph, created_at, updated_at) values ('agt', 'A', 'role', 'glyph', 1, 1)"
      )
      .run()
    sqlite
      .prepare(
        "insert into memories (id, agent_id, content, created_at) values ('keep', 'agt', 'likes tea', 10)"
      )
      .run()
    assert.throws(() => {
      sqlite
        .prepare(
          "insert into memories (id, agent_id, content, created_at) values ('nope', null, 'too soon', 11)"
        )
        .run()
    })

    migrate(db, { migrationsFolder })

    const kept = sqlite
      .prepare("select agent_id as agentId, content from memories where id = 'keep'")
      .get()
    assert.deepEqual(kept, { agentId: "agt", content: "likes tea" })

    sqlite
      .prepare(
        "insert into memories (id, agent_id, content, created_at) values ('shared', null, 'all agents', 12)"
      )
      .run()
    assert.throws(() => {
      sqlite
        .prepare(
          "insert into memories (id, agent_id, content, created_at) values ('bad', 'missing', 'no', 13)"
        )
        .run()
    })

    sqlite.prepare("delete from agents where id = 'agt'").run()
    const left = sqlite.prepare("select id, content from memories").all()
    assert.deepEqual(left, [{ id: "shared", content: "all agents" }])
  } finally {
    close(sqlite, dir)
  }
})
