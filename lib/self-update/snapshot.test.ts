import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

const script = path.join(import.meta.dirname, "../../scripts/self-update-snapshot.mjs")

test("snapshot copies subdirectories and leaves backups, keys, and links behind", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-snap-"))
  const from = path.join(root, "from")
  const to = path.join(root, "to")
  try {
    fs.mkdirSync(path.join(from, "skills", "demo", "extra"), { recursive: true })
    fs.mkdirSync(path.join(from, "backups"), { recursive: true })
    fs.writeFileSync(path.join(from, "skills", "demo", "SKILL.md"), "hello\n")
    fs.writeFileSync(path.join(from, "skills", "demo", "extra", "note.txt"), "nested\n")
    fs.writeFileSync(path.join(from, "backups", "old.db"), "nope")
    fs.writeFileSync(path.join(from, "vault-live.key"), "secret")
    fs.writeFileSync(path.join(from, ".env"), "TOKEN=1\n")
    fs.writeFileSync(path.join(from, "notes.txt"), "top\n")
    const outside = path.join(root, "outside.txt")
    fs.writeFileSync(outside, "hidden\n")
    fs.symlinkSync(outside, path.join(from, "linked.txt"))
    fs.symlinkSync(path.join(from, "skills"), path.join(from, "skills-link"))
    const db = new Database(path.join(from, "xiryn.db"))
    db.exec("create table t (id integer)")
    db.close()

    execFileSync(process.execPath, [script, "--from", from, "--to", to], {
      encoding: "utf8",
    })

    assert.equal(
      fs.readFileSync(path.join(to, "skills", "demo", "SKILL.md"), "utf8"),
      "hello\n"
    )
    assert.equal(
      fs.readFileSync(path.join(to, "skills", "demo", "extra", "note.txt"), "utf8"),
      "nested\n"
    )
    assert.equal(fs.readFileSync(path.join(to, "notes.txt"), "utf8"), "top\n")
    assert.equal(fs.existsSync(path.join(to, "xiryn.db")), true)
    assert.equal(fs.statSync(path.join(to, "xiryn.db")).mode & 0o777, 0o600)
    assert.equal(
      fs.statSync(path.join(to, "skills", "demo", "SKILL.md")).mode & 0o777,
      0o600
    )
    assert.equal(fs.existsSync(path.join(to, "backups")), false)
    assert.equal(fs.existsSync(path.join(to, "vault-live.key")), false)
    assert.equal(fs.existsSync(path.join(to, ".env")), false)
    assert.equal(fs.existsSync(path.join(to, "linked.txt")), false)
    assert.equal(fs.existsSync(path.join(to, "skills-link")), false)
    const copy = new Database(path.join(to, "xiryn.db"), { readonly: true })
    const row = copy.prepare("select count(*) as n from t").get() as { n: number }
    copy.close()
    assert.equal(row.n, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
