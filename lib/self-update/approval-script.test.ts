import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

const script = path.join(import.meta.dirname, "../../scripts/self-update-approval.mjs")

test("consuming an approval marks it used once and a second consume does not revive it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-approval-"))
  const dbPath = path.join(root, "xiryn.db")
  try {
    const db = new Database(dbPath)
    db.exec(`create table action_approvals (
      id text primary key,
      tool text not null,
      args text not null,
      args_hash text not null,
      status text not null,
      expires_at integer
    )`)
    db.prepare(
      "insert into action_approvals (id, tool, args, args_hash, status, expires_at) values (?, ?, ?, ?, ?, ?)"
    ).run("approve01", "request_self_update", "{}", "abc", "approved", 9_999_999_999_999)
    db.close()

    const first = execFileSync(
      process.execPath,
      [script, "--db", dbPath, "--id", "approve01", "--consume"],
      { encoding: "utf8" }
    )
    assert.equal(JSON.parse(first).status, "approved")
    const after = new Database(dbPath, { readonly: true })
    const used = after
      .prepare("select status from action_approvals where id = ?")
      .get("approve01") as { status: string }
    after.close()
    assert.equal(used.status, "used")

    const second = execFileSync(
      process.execPath,
      [script, "--db", dbPath, "--id", "approve01", "--consume"],
      { encoding: "utf8" }
    )
    assert.equal(JSON.parse(second).status, "used")
    const again = new Database(dbPath, { readonly: true })
    const still = again
      .prepare("select status from action_approvals where id = ?")
      .get("approve01") as { status: string }
    again.close()
    assert.equal(still.status, "used")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
