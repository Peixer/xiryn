import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

import {
  drainAndFreeze,
  quiescenceSatisfied,
  readQuiesce,
  resumeProcessWrites,
  setWriteFrozen,
  waitForQuiescence,
  writeQuiesce,
  type QuiesceAck,
} from "./write-freeze"

function ack(over: Partial<QuiesceAck> = {}): QuiesceAck {
  return {
    colour: "blue",
    token: "1",
    queryOnly: true,
    workers: "stopped",
    activeRuns: 0,
    at: 10,
    ...over,
  }
}

test("query_only blocks writes on the open connection and thaw allows them", () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-freeze-")),
    "xiryn.db"
  )
  const db = new Database(file)
  db.exec("create table notes (id integer primary key)")
  db.exec("insert into notes (id) values (1)")
  setWriteFrozen(db, true)
  assert.throws(() => db.exec("insert into notes (id) values (2)"))
  setWriteFrozen(db, false)
  db.exec("insert into notes (id) values (3)")
  const count = db.prepare("select count(*) as n from notes").get() as { n: number }
  assert.equal(count.n, 2)
  db.close()
})

test("a reserved lock keeps the snapshot consistent while another connection writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-lock-"))
  const source = path.join(dir, "source.db")
  const copy = path.join(dir, "copy.db")
  const holder = new Database(source)
  holder.exec("create table notes (id integer primary key)")
  holder.exec("insert into notes (id) values (1)")
  holder.pragma("busy_timeout = 30000")
  holder.exec("BEGIN IMMEDIATE")
  const writer = new Database(source)
  writer.pragma("busy_timeout = 100")
  assert.throws(() => writer.exec("insert into notes (id) values (2)"))
  const reader = new Database(source, { readonly: true, fileMustExist: true })
  await reader.backup(copy)
  reader.close()
  holder.exec("ROLLBACK")
  holder.close()
  writer.close()
  const saved = new Database(copy, { readonly: true })
  const row = saved.prepare("select count(*) as n from notes").get() as { n: number }
  assert.equal(row.n, 1)
  saved.close()
})

test("an ack counts only when writes are stopped and the maintenance token matches", () => {
  assert.equal(quiescenceSatisfied(ack(), "1"), true)
  assert.equal(quiescenceSatisfied(ack({ token: "2" }), "1"), false)
  assert.equal(quiescenceSatisfied(ack({ activeRuns: 1 }), "1"), false)
  assert.equal(quiescenceSatisfied(null, "1"), false)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-ack-"))
  const file = path.join(dir, "quiesce-blue.json")
  writeQuiesce(file, ack())
  assert.equal(quiescenceSatisfied(readQuiesce(file), "1"), true)
})

test("the helper waits until the ack appears and then stops waiting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-wait-"))
  const file = path.join(dir, "quiesce-blue.json")
  let now = 0
  let slept = 0
  const ready = waitForQuiescence({
    acks: [{ file, token: "9" }],
    timeoutMs: 100,
    now: () => now,
    sleep: () => {
      slept++
      if (slept === 2) writeQuiesce(file, ack({ token: "9" }))
      now += 40
    },
  })
  assert.equal(ready, true)
  assert.equal(slept, 2)
})

test("drain freezes the connection and records that no runs are left", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-drain-"))
  const dbFile = path.join(dir, "xiryn.db")
  const ackFile = path.join(dir, "quiesce-blue.json")
  const db = new Database(dbFile)
  db.exec("create table notes (id integer primary key)")
  let busy = 1
  const pending = drainAndFreeze({
    sqlite: db,
    busy: () => busy,
    ackFile,
    colour: "blue",
    token: "tok",
    timeoutMs: 200,
  })
  setTimeout(() => {
    busy = 0
  }, 30)
  await pending
  assert.throws(() => db.exec("insert into notes (id) values (1)"))
  const written = readQuiesce(ackFile)
  assert.equal(written?.token, "tok")
  assert.equal(written?.activeRuns, 0)
  resumeProcessWrites(db)
  db.exec("insert into notes (id) values (1)")
  db.close()
})
