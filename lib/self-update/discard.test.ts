import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

import { renderApprovalPreview } from "@/lib/mcp/approval-preview"
import { buildSelfUpdateArgs } from "@/lib/self-update/submit"
import { initialState } from "@/lib/self-update/state"

import {
  assessDiscard,
  assertRollbackConfirmation,
  formatDiscardImpact,
  rollbackCallbackDecision,
} from "./discard"

const SINCE = "2026-10-24T08:00:00.000Z"
const BEFORE = Date.parse("2026-10-24T07:00:00.000Z")
const AFTER = Date.parse("2026-10-24T09:00:00.000Z")

function seed(file: string, sql: string) {
  const db = new Database(file)
  db.exec(`
    CREATE TABLE messages (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE vault_items (
      id TEXT PRIMARY KEY,
      created_at INTEGER,
      updated_at INTEGER,
      last_used_at INTEGER
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, updated_at INTEGER NOT NULL);
  `)
  db.exec(sql)
  db.close()
}

test("rollback counts writes since the switch and rows the old database would restore", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-discard-"))
  const active = path.join(dir, "active.db")
  const previous = path.join(dir, "previous.db")
  seed(
    active,
    `
      INSERT INTO messages (id, created_at) VALUES ('old', ${BEFORE}), ('new', ${AFTER});
      INSERT INTO vault_items (id, created_at, updated_at) VALUES ('kept', ${BEFORE}, ${BEFORE});
      INSERT INTO settings (key, updated_at) VALUES ('theme', ${AFTER});
    `
  )
  seed(
    previous,
    `
      INSERT INTO messages (id, created_at) VALUES ('old', ${BEFORE});
      INSERT INTO vault_items (id, created_at) VALUES
        ('kept', ${BEFORE}),
        ('deleted-secret', ${BEFORE});
    `
  )
  const impact = assessDiscard({
    since: SINCE,
    activePath: active,
    previousPath: previous,
  })
  assert.equal(impact.since, SINCE)
  assert.equal(impact.written, 2)
  assert.equal(impact.restored, 1)
  const text = formatDiscardImpact(impact)
  assert.match(text, new RegExp(SINCE))
  assert.match(text, /2 timestamped rows/)
  assert.match(text, /1 removed row/)
  assert.match(text, /backup/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("a missing previous database still warns that removed rows come back", () => {
  const text = formatDiscardImpact({ since: null, written: null, restored: null })
  assert.match(text, /since the switch/)
  assert.match(text, /vault items/)
  assert.match(text, /could not be counted/)
})

test("rollback confirmation is a separate check from the approval hash", () => {
  assert.equal(assertRollbackConfirmation("switch", undefined), null)
  assert.equal(
    assertRollbackConfirmation("rollback", false),
    assertRollbackConfirmation("rollback", undefined)
  )
  assert.match(assertRollbackConfirmation("rollback", undefined) ?? "", /discarded/)
  assert.equal(assertRollbackConfirmation("rollback", true), null)
})

test("telegram approves a rollback only from the discard button", () => {
  assert.deepEqual(rollbackCallbackDecision({ isRollback: true, verb: "yes" }), {
    ok: false,
    error: "Confirm that data written since the switch will be discarded.",
  })
  assert.deepEqual(rollbackCallbackDecision({ isRollback: true, verb: "discard" }), {
    ok: true,
    choice: "approve",
  })
  assert.deepEqual(rollbackCallbackDecision({ isRollback: false, verb: "discard" }), {
    ok: false,
    error: "That confirmation is only for a rollback.",
  })
  assert.deepEqual(rollbackCallbackDecision({ isRollback: false, verb: "yes" }), {
    ok: true,
    choice: "approve",
  })
  assert.deepEqual(rollbackCallbackDecision({ isRollback: true, verb: "no" }), {
    ok: true,
    choice: "decline",
  })
})

test("the rollback card names the loss and a switch card does not", () => {
  const rollback = renderApprovalPreview("request_self_update", {
    op: "rollback",
    sha: "a".repeat(40),
    from: "green",
    to: "blue",
    branch: "main",
    discardSince: SINCE,
  })
  assert.match(rollback, /Data written since 2026-10-24T08:00:00.000Z will be discarded/)
  assert.match(rollback, /vault items/)
  assert.match(rollback, /backup/)
  assert.match(rollback, /Nothing changes until you approve/)
  const switched = renderApprovalPreview("request_self_update", {
    op: "switch",
    sha: "b".repeat(40),
    from: "blue",
    to: "green",
    branch: "main",
  })
  assert.equal(switched.includes("discarded"), false)
})

test("only rollback arguments carry discardSince", () => {
  const state = initialState({
    phase: "active",
    baseline: "active",
    active: "green",
    activeSha: "b".repeat(40),
    previous: "blue",
    previousSha: "a".repeat(40),
    switchedAt: SINCE,
  })
  const rollback = buildSelfUpdateArgs(state, "rollback", "a".repeat(40))
  assert.equal(rollback.discardSince, SINCE)
  const ready = initialState({
    phase: "ready",
    activeSha: "a".repeat(40),
    candidate: "green",
    candidateSha: "b".repeat(40),
    switchedAt: SINCE,
  })
  const switched = buildSelfUpdateArgs(ready, "switch", "b".repeat(40))
  assert.equal("discardSince" in switched, false)
})
