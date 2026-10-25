import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { DEFAULT_LAYOUT, type Layout } from "./layout"
import { isMountRoot, relocateTree, removeTree, resetDirectory } from "./mount-root"

function layoutUnder(root: string): Layout {
  return {
    ...DEFAULT_LAYOUT,
    mirror: path.join(root, "pin.git"),
    blueDir: path.join(root, "blue"),
    greenDir: path.join(root, "green"),
    blueData: path.join(root, "colours", "blue"),
    greenData: path.join(root, "colours", "green"),
    backupDir: path.join(root, "backups"),
    deployDir: path.join(root, "deploy"),
    caddyfile: path.join(root, "caddy", "Caddyfile"),
    caddySnippet: path.join(root, "caddy", "upstreams.caddy"),
    sharedEnv: path.join(root, "xiryn", "shared.env"),
    vaultDir: path.join(root, "xiryn", "vault"),
    maintenanceFile: path.join(root, "xiryn", "maintenance"),
  }
}

function busy(target: string) {
  const error = new Error(
    `EBUSY: resource busy or locked, rmdir '${target}'`
  ) as NodeJS.ErrnoException
  error.code = "EBUSY"
  error.syscall = "rmdir"
  return error
}

test("resetting a colour directory keeps the mount and drops its children", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-mount-"))
  const layout = layoutUnder(root)
  const outside = path.join(root, "outside.txt")
  fs.mkdirSync(layout.greenDir)
  fs.writeFileSync(path.join(layout.greenDir, "stale.txt"), "old\n")
  fs.mkdirSync(path.join(layout.greenDir, "nested"))
  fs.writeFileSync(outside, "keep\n")
  fs.symlinkSync(outside, path.join(layout.greenDir, "link"))
  const inode = fs.statSync(layout.greenDir).ino
  const realRm = fs.rmSync
  fs.rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
    if (path.resolve(String(target)) === path.resolve(layout.greenDir))
      throw busy(layout.greenDir)
    return realRm(target, options)
  }) as typeof fs.rmSync
  try {
    assert.equal(isMountRoot(layout, layout.greenDir), true)
    assert.equal(isMountRoot(layout, path.join(layout.deployDir, "staging")), true)
    resetDirectory(layout.greenDir)
    assert.equal(fs.statSync(layout.greenDir).ino, inode)
    assert.deepEqual(fs.readdirSync(layout.greenDir), [])
    assert.equal(fs.readFileSync(outside, "utf8"), "keep\n")
  } finally {
    fs.rmSync = realRm
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("a directory that is not listed still survives when rmdir returns EBUSY", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-busy-"))
  const layout = layoutUnder(root)
  const extra = path.join(root, "extra")
  fs.mkdirSync(extra)
  fs.writeFileSync(path.join(extra, "file.txt"), "x\n")
  const inode = fs.statSync(extra).ino
  const realRm = fs.rmSync
  fs.rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
    if (path.resolve(String(target)) === path.resolve(extra)) throw busy(extra)
    return realRm(target, options)
  }) as typeof fs.rmSync
  try {
    assert.equal(isMountRoot(layout, extra), false)
    removeTree(layout, extra)
    assert.equal(fs.statSync(extra).ino, inode)
    assert.deepEqual(fs.readdirSync(extra), [])
  } finally {
    fs.rmSync = realRm
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("relocating across mount points keeps a mount root and still moves a stamp", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-move-"))
  const layout = layoutUnder(root)
  fs.mkdirSync(layout.greenDir)
  fs.writeFileSync(path.join(layout.greenDir, "db"), "rows\n")
  fs.mkdirSync(path.join(layout.deployDir, "staging"), { recursive: true })
  const stamp = path.join(layout.deployDir, "staging", "2026-prepare")
  fs.mkdirSync(stamp)
  fs.writeFileSync(path.join(stamp, "label.txt"), "prepare\n")
  const realRename = fs.renameSync
  fs.renameSync = (() => {
    const error = new Error("EBUSY") as NodeJS.ErrnoException
    error.code = "EBUSY"
    error.syscall = "rename"
    throw error
  }) as typeof fs.renameSync
  try {
    const kept = path.join(layout.backupDir, "kept")
    relocateTree(layout, layout.greenDir, kept)
    assert.equal(fs.readFileSync(path.join(kept, "db"), "utf8"), "rows\n")
    assert.equal(fs.statSync(layout.greenDir).isDirectory(), true)
    assert.deepEqual(fs.readdirSync(layout.greenDir), [])

    const moved = path.join(layout.backupDir, "moved")
    relocateTree(layout, stamp, moved)
    assert.equal(fs.readFileSync(path.join(moved, "label.txt"), "utf8"), "prepare\n")
    assert.equal(fs.existsSync(stamp), false)
    assert.equal(fs.statSync(path.join(layout.deployDir, "staging")).isDirectory(), true)
  } finally {
    fs.renameSync = realRename
    fs.rmSync(root, { recursive: true, force: true })
  }
})
