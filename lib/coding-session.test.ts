import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { resolveCodexBin, resolveClaudeBin, runCodingSession } from "./coding-session"
test("binary resolvers return executable paths or null", () => {
  for (const value of [resolveCodexBin(), resolveClaudeBin()])
    assert.ok(value === null || typeof value === "string")
})
test("missing CLI returns failure without invoking a model", async () => {
  const result = await runCodingSession({
    tool: "codex",
    task: "test",
    workdir: "/tmp",
    run: async () => {
      throw new Error("CLI not found")
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.error!, /not found/)
})
test("streams mock output and passes command arguments", async () => {
  let output = ""
  const result = await runCodingSession({
    tool: "claude-code",
    task: "hello",
    workdir: "/tmp",
    onOutput: (line) => {
      output += line
    },
    run: async (command, opts) => {
      assert.ok(command.includes("hello"))
      assert.equal(opts.cwd, "/tmp")
      opts.onOutput?.("hello\n")
      return { text: "hello\n", exitCode: 0 }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(output, "hello\n")
})

test("missing executable is reported by binary discovery", async (t) => {
  t.mock.method(fs, "accessSync", () => {
    throw new Error("ENOENT")
  })
  const result = await runCodingSession({
    tool: "codex",
    task: "never run",
    workdir: "/tmp",
  })
  assert.equal(result.ok, false)
  assert.match(result.error!, /not found/)
})

test("runs a fake executable and streams its output without a model", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-session-test-"))
  const bin = path.join(home, "codex-cli/node_modules/.bin/codex")
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(bin, '#!/bin/sh\necho "hello"\n', { mode: 0o755 })
  t.mock.method(os, "homedir", () => home)
  let output = ""
  try {
    const result = await runCodingSession({
      tool: "codex",
      task: "ignored",
      workdir: home,
      onOutput: (chunk) => {
        output += chunk
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.text, "hello\n")
    assert.equal(output, "hello\n")
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
