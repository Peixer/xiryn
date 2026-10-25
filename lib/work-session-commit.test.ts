import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { commitWorktreeChanges, isUntrackedBuildArtifact } from "./work-session-commit"

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-commit-"))
  git(dir, ["init"])
  git(dir, ["config", "user.email", "test@example.com"])
  git(dir, ["config", "user.name", "Test"])
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n")
  fs.writeFileSync(path.join(dir, ".gitignore"), "secret.env\n")
  git(dir, ["add", "README.md", ".gitignore"])
  git(dir, ["commit", "-m", "init"])
  return dir
}

function runGit(args: string[]) {
  return Promise.resolve(execFileSync("git", args, { encoding: "utf8" }))
}

test("untracked build directories are recognised", () => {
  assert.equal(isUntrackedBuildArtifact("dist/app.js"), true)
  assert.equal(isUntrackedBuildArtifact("src/notes.ts"), false)
  assert.equal(isUntrackedBuildArtifact("lib/work-sessions.ts"), false)
})

test("skips the commit when the only changes are untracked build artifacts", async () => {
  const dir = initRepo()
  const logs: string[] = []
  const info = console.info
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "))
  }
  try {
    fs.mkdirSync(path.join(dir, "dist"))
    fs.writeFileSync(path.join(dir, "dist", "app.js"), "console.log(1)\n")
    fs.writeFileSync(path.join(dir, "secret.env"), "nope\n")
    const result = await commitWorktreeChanges({
      cwd: dir,
      runGit,
      onSkip: (filePath) => logs.push(`skip ${filePath}`),
    })
    assert.equal(result.committed, false)
    assert.ok(result.skipped.some((item) => item.path === "dist/app.js"))
    assert.match(git(dir, ["status", "--porcelain", "-uall"]), /dist\/app\.js/)
    assert.equal(git(dir, ["log", "-1", "--format=%s"]).trim(), "init")
    assert.equal(git(dir, ["ls-files"]).includes("secret.env"), false)
    assert.ok(logs.some((line) => line.includes("dist/app.js")))
  } finally {
    console.info = info
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("does not stage oversized files and still commits the rest", async () => {
  const dir = initRepo()
  const logs: string[] = []
  const info = console.info
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "))
  }
  try {
    fs.mkdirSync(path.join(dir, "node_modules"))
    fs.writeFileSync(path.join(dir, "node_modules", "pkg.js"), "module.exports = {}\n")
    fs.writeFileSync(path.join(dir, "big.bin"), "x".repeat(50))
    fs.writeFileSync(path.join(dir, "ok.ts"), "export {}\n")
    fs.writeFileSync(path.join(dir, "secret.env"), "hidden\n")
    const result = await commitWorktreeChanges({
      cwd: dir,
      runGit,
      maxBytes: 30,
      onSkip: (filePath, reason) => logs.push(`${filePath}: ${reason}`),
    })
    assert.equal(result.committed, true)
    assert.ok(result.skipped.some((item) => item.path === "node_modules/pkg.js"))
    assert.ok(
      result.skipped.some(
        (item) => item.path === "big.bin" && /stage limit/.test(item.reason)
      )
    )
    const files = git(dir, ["ls-files"])
    assert.match(files, /ok\.ts/)
    assert.equal(files.includes("big.bin"), false)
    assert.equal(files.includes("node_modules/pkg.js"), false)
    assert.equal(files.includes("secret.env"), false)
    assert.ok(logs.some((line) => line.includes("big.bin")))
    assert.ok(logs.some((line) => line.includes("node_modules/pkg.js")))
  } finally {
    console.info = info
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
