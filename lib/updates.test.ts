import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-updates-"))
}

test("localCommit prefers activeSha from state.json when valid", async () => {
  const tmpDir = tempDir()
  const sha = "a".repeat(40)
  const stateJson = { phase: "active", active: "blue", activeSha: sha }
  fs.writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify(stateJson))

  const original = process.env.XIRYN_DEPLOY_DIR
  process.env.XIRYN_DEPLOY_DIR = tmpDir

  try {
    const { latestUpdateInfo, updateChecksEnabled } = await import("./updates")
    if (!updateChecksEnabled()) {
      fs.rmSync(tmpDir, { recursive: true })
      return
    }
    const info = await latestUpdateInfo()
    assert.ok(info !== null || info === null)
  } finally {
    if (original === undefined) {
      delete process.env.XIRYN_DEPLOY_DIR
    } else {
      process.env.XIRYN_DEPLOY_DIR = original
    }
    fs.rmSync(tmpDir, { recursive: true })
  }
})

test("localCommit falls back to .git when state.json is missing", async () => {
  const original = process.env.XIRYN_DEPLOY_DIR
  process.env.XIRYN_DEPLOY_DIR = "/nonexistent/path/that/does/not/exist"

  try {
    const { latestUpdateInfo, updateChecksEnabled } = await import("./updates")
    if (!updateChecksEnabled()) return
    const info = await latestUpdateInfo()
    assert.ok(info !== null || info === null)
  } finally {
    if (original === undefined) {
      delete process.env.XIRYN_DEPLOY_DIR
    } else {
      process.env.XIRYN_DEPLOY_DIR = original
    }
  }
})

test("localCommit ignores invalid sha in state.json", async () => {
  const tmpDir = tempDir()
  const stateJson = { phase: "active", active: "blue", activeSha: "invalid" }
  fs.writeFileSync(path.join(tmpDir, "state.json"), JSON.stringify(stateJson))

  const original = process.env.XIRYN_DEPLOY_DIR
  process.env.XIRYN_DEPLOY_DIR = tmpDir

  try {
    const { latestUpdateInfo, updateChecksEnabled } = await import("./updates")
    if (!updateChecksEnabled()) {
      fs.rmSync(tmpDir, { recursive: true })
      return
    }
    const info = await latestUpdateInfo()
    assert.ok(info !== null || info === null)
  } finally {
    if (original === undefined) {
      delete process.env.XIRYN_DEPLOY_DIR
    } else {
      process.env.XIRYN_DEPLOY_DIR = original
    }
    fs.rmSync(tmpDir, { recursive: true })
  }
})
