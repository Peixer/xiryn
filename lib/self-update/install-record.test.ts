import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { vaultAccount } from "@/lib/vault-account"

function runInstaller(env: Record<string, string>) {
  return spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", ...env },
  })
}

test("the installer pins one vault account for both colours and keeps it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynacct"))
  const oldData = path.join(root, "opt", "data")
  const otherData = path.join(root, "somewhere", "else")
  const blue = path.join(root, "blue.env")
  const green = path.join(root, "green.env")
  const account = vaultAccount(path.join(oldData, "xiryn.db"))
  const env = {
    XIRYN_COLOUR_ENV_ONLY: "1",
    XIRYN_OLD_DATA: oldData,
    XIRYN_BLUE_ENV: blue,
    XIRYN_GREEN_ENV: green,
    XIRYN_SHARED_ENV: path.join(root, "missing.env"),
  }
  try {
    const first = runInstaller(env)
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const line = `XIRYN_VAULT_ACCOUNT=${account}`
    for (const file of [blue, green]) {
      const lines = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((row) => row.startsWith("XIRYN_VAULT_ACCOUNT="))
      assert.deepEqual(lines, [line], file)
    }
    assert.notEqual(account, vaultAccount(path.join(otherData, "xiryn.db")))
    const second = runInstaller({ ...env, XIRYN_OLD_DATA: otherData })
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    for (const file of [blue, green]) {
      const lines = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((row) => row.startsWith("XIRYN_VAULT_ACCOUNT="))
      assert.deepEqual(lines, [line], file)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("the installer records the deployed commit and does not replace it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynstate"))
  const file = path.join(root, "deploy", "state.json")
  const first = "a".repeat(40)
  const second = "b".repeat(40)
  const work = path.join(root, "tree")
  fs.mkdirSync(work)
  execFileSync("git", ["init", "-b", "main", work])
  execFileSync("git", ["-C", work, "config", "user.email", "test@example.com"])
  execFileSync("git", ["-C", work, "config", "user.name", "test"])
  fs.writeFileSync(path.join(work, "README"), "hi\n")
  execFileSync("git", ["-C", work, "add", "README"])
  execFileSync("git", ["-C", work, "commit", "-m", "one"])
  const sha = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim()
  try {
    const recorded = runInstaller({
      XIRYN_SHA_ONLY: "1",
      XIRYN_SHA_TREE: work,
    })
    assert.equal(recorded.status, 0, recorded.stderr)
    assert.equal(recorded.stdout.trim(), sha)

    const missing = runInstaller({
      XIRYN_STATE_ONLY: "1",
      XIRYN_STATE_FILE: file,
      XIRYN_STATE_SHA: "not-a-commit",
      XIRYN_STATE_BRANCH: "main",
    })
    assert.notEqual(missing.status, 0)
    assert.equal(fs.existsSync(file), false)

    const wrote = runInstaller({
      XIRYN_STATE_ONLY: "1",
      XIRYN_STATE_FILE: file,
      XIRYN_STATE_SHA: first,
      XIRYN_STATE_COLOUR: "blue",
      XIRYN_STATE_BRANCH: "main",
    })
    assert.equal(wrote.status, 0, `${wrote.stdout}\n${wrote.stderr}`)
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as {
      phase: string
      active: string
      activeSha: string
      baseline: string
      branch: string
    }
    assert.equal(state.phase, "active")
    assert.equal(state.active, "blue")
    assert.equal(state.activeSha, first)
    assert.equal(state.baseline, "active")
    assert.equal(state.branch, "main")
    assert.equal(fs.statSync(file).mode & 0o777, 0o644)

    const again = runInstaller({
      XIRYN_STATE_ONLY: "1",
      XIRYN_STATE_FILE: file,
      XIRYN_STATE_SHA: second,
      XIRYN_STATE_COLOUR: "green",
      XIRYN_STATE_BRANCH: "main",
    })
    assert.equal(again.status, 0, again.stderr)
    const kept = JSON.parse(fs.readFileSync(file, "utf8")) as { activeSha: string }
    assert.equal(kept.activeSha, first)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
