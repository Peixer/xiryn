import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import Database from "better-sqlite3"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(name: string) {
  return fs.readFileSync(path.join(root, "db", "migrations", name), "utf8")
}

test("0005 adds args_hash and keeps existing approval rows", () => {
  const sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  sqlite.exec(`
    CREATE TABLE threads (id text PRIMARY KEY);
    CREATE TABLE agents (id text PRIMARY KEY);
  `)
  const create = read("0004_vengeful_freak.sql").split("--> statement-breakpoint")[0]
  sqlite.exec(create)
  sqlite.prepare("insert into threads (id) values (?)").run("t1")
  sqlite
    .prepare(
      `insert into action_approvals
        (id, thread_id, agent_id, tool, args, summary, status, created_at, decided_at, expires_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "a1",
      "t1",
      null,
      "gmail_send",
      '{"body":"board packet","to":"ada@example.com"}',
      "Send to ada@example.com",
      "approved",
      1_700_000_000_000,
      1_700_000_000_100,
      1_700_000_001_000
    )

  sqlite.exec(read("0005_approval_args_hash.sql"))

  const row = sqlite.prepare("select * from action_approvals where id = ?").get("a1") as {
    id: string
    thread_id: string
    tool: string
    args: string
    summary: string
    status: string
    args_hash: string
    created_at: number
    decided_at: number
    expires_at: number
  }
  assert.equal(row.id, "a1")
  assert.equal(row.thread_id, "t1")
  assert.equal(row.tool, "gmail_send")
  assert.equal(row.args, '{"body":"board packet","to":"ada@example.com"}')
  assert.equal(row.summary, "Send to ada@example.com")
  assert.equal(row.status, "approved")
  assert.equal(row.args_hash, "")
  assert.equal(row.created_at, 1_700_000_000_000)
  assert.equal(row.decided_at, 1_700_000_000_100)
  assert.equal(row.expires_at, 1_700_000_001_000)
  const count = sqlite.prepare("select count(*) as n from action_approvals").get() as {
    n: number
  }
  assert.equal(count.n, 1)

  const column = sqlite.prepare("PRAGMA table_info(action_approvals)").all() as {
    name: string
    notnull: number
    dflt_value: string | null
  }[]
  const hash = column.find((item) => item.name === "args_hash")
  assert.ok(hash)
  assert.equal(hash.notnull, 1)
  assert.equal(hash.dflt_value, "''")

  sqlite.close()
})
