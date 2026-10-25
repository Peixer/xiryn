import { test } from "node:test"
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
