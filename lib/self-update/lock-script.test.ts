import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

const script = path.join(import.meta.dirname, "../../scripts/self-update-lock.mjs")

function held(child: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve, reject) => {
    let text = ""
    const timer = setTimeout(() => reject(new Error("lock did not start")), 5_000)
    const onExit = (code: number | null) => {
      clearTimeout(timer)
      reject(new Error(`lock exited ${code} before held: ${text}`))
    }
    child.once("exit", onExit)
    child.stdout?.on("data", (chunk) => {
      text += String(chunk)
      if (!text.includes("held")) return
      clearTimeout(timer)
      child.off("exit", onExit)
      resolve()
    })
  })
}

test("the lock script blocks writers until the helper releases it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-lock-"))
  const dbPath = path.join(dir, "xiryn.db")
  const setup = new Database(dbPath)
  setup.exec("create table notes (id integer primary key)")
  setup.close()
  const child = spawn(process.execPath, [script, "--db", dbPath], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  try {
    await held(child)
    const blocked = new Database(dbPath)
    blocked.pragma("busy_timeout = 200")
    assert.throws(() => blocked.exec("insert into notes (id) values (1)"))
    blocked.close()
    child.stdin?.write("release\n")
    const code = await new Promise<number | null>((resolve) =>
      child.once("exit", resolve)
    )
    assert.equal(code, 0)
    const open = new Database(dbPath)
    open.exec("insert into notes (id) values (1)")
    const row = open.prepare("select count(*) as n from notes").get() as { n: number }
    assert.equal(row.n, 1)
    open.close()
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("the lock script refuses a database path that is not a colour file", async () => {
  const child = spawn(process.execPath, [script, "--db", "/tmp/other.sqlite"], {
    stdio: ["ignore", "ignore", "pipe"],
  })
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve))
  assert.equal(code, 2)
})
