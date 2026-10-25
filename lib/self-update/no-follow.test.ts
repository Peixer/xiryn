import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { copyFileNoFollow, sealRoot, writeAtomicNoFollow } from "./system-host"

test("atomic root writes replace destination and temporary symlinks without changing targets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-no-follow-"))
  try {
    const victim = path.join(dir, "victim")
    const dest = path.join(dir, "state.json")
    fs.writeFileSync(victim, "secret")
    fs.symlinkSync(victim, dest)
    fs.symlinkSync(victim, `${dest}.tmp.${process.pid}`)
    writeAtomicNoFollow(dest, "new state")
    assert.equal(fs.readFileSync(victim, "utf8"), "secret")
    assert.equal(fs.readFileSync(dest, "utf8"), "new state")
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("secret copies reject source symlinks and replace destination symlinks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-copy-"))
  try {
    const src = path.join(dir, "source")
    const dest = path.join(dir, "dest")
    const link = path.join(dir, "link")
    const victim = path.join(dir, "victim")
    fs.writeFileSync(src, "secret")
    fs.writeFileSync(victim, "untouched")
    fs.symlinkSync(src, link)
    assert.throws(() => copyFileNoFollow(link, dest), /Refusing to copy symlink/)
    assert.throws(() => copyFileNoFollow(dir, dest), /non-regular/)
    fs.symlinkSync(victim, dest)
    copyFileNoFollow(src, dest)
    assert.equal(fs.readFileSync(victim, "utf8"), "untouched")
    assert.equal(fs.readFileSync(dest, "utf8"), "secret")
    assert.equal(fs.statSync(dest).mode & 0o777, 0o600)
    assert.throws(() => sealRoot(dir), /Refusing to copy symlink/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
