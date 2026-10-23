import assert from "node:assert/strict"
import { test } from "node:test"

import type { McpServerShape } from "./stdio-policy"
import {
  STDIO_CONFIRM_TTL_MS,
  authorizeStdioSave,
  issueStdioConfirmation,
  resetStdioConfirmations,
} from "./stdio-confirm"

function stdio(id: string, command: string, args: string[] = []): McpServerShape {
  return { id, transport: "stdio", command, args }
}

test("stdio confirmation tokens", async (t) => {
  await t.test("a token is bound to that command and args, once", () => {
    resetStdioConfirmations()
    const previous: McpServerShape[] = []
    const next = [stdio("notes", "npx", ["-y", "notes-mcp"])]
    const launched = [{ id: "notes", command: "npx", args: ["-y", "notes-mcp"] }]

    const missing = authorizeStdioSave({ previous, next })
    assert.equal(missing.ok, false)
    if (missing.ok) return
    assert.deepEqual(missing.confirm, launched)

    const token = issueStdioConfirmation(launched, 1_000)
    const wrongArgs = authorizeStdioSave({
      previous,
      next: [stdio("notes", "npx", ["-y", "other"])],
      token,
      now: 1_000,
    })
    assert.equal(wrongArgs.ok, false)

    const spent = authorizeStdioSave({ previous, next, token, now: 1_000 })
    assert.equal(spent.ok, false)

    const again = issueStdioConfirmation(launched, 1_000)
    const ok = authorizeStdioSave({ previous, next, token: again, now: 1_000 })
    assert.equal(ok.ok, true)

    const replay = authorizeStdioSave({ previous, next, token: again, now: 1_000 })
    assert.equal(replay.ok, false)
  })

  await t.test("a token for one command cannot save another, and expiry holds", () => {
    resetStdioConfirmations()
    const previous = [stdio("notes", "npx", ["-y", "notes-mcp"])]
    const same = authorizeStdioSave({
      previous,
      next: [stdio("notes", "npx", ["-y", "notes-mcp"])],
    })
    assert.equal(same.ok, true)

    const changed = [stdio("notes", "node", ["server.js"])]
    const token = issueStdioConfirmation(
      [{ id: "notes", command: "npx", args: ["-y", "notes-mcp"] }],
      5_000
    )
    const mismatched = authorizeStdioSave({ previous, next: changed, token, now: 5_000 })
    assert.equal(mismatched.ok, false)

    const fresh = issueStdioConfirmation(
      [{ id: "notes", command: "node", args: ["server.js"] }],
      5_000
    )
    const expired = authorizeStdioSave({
      previous,
      next: changed,
      token: fresh,
      now: 5_000 + STDIO_CONFIRM_TTL_MS,
    })
    assert.equal(expired.ok, false)

    const live = issueStdioConfirmation(
      [{ id: "notes", command: "node", args: ["server.js"] }],
      5_000
    )
    const saved = authorizeStdioSave({
      previous,
      next: changed,
      token: live,
      now: 5_000 + STDIO_CONFIRM_TTL_MS - 1,
    })
    assert.equal(saved.ok, true)
  })

  await t.test("a disallowed command is refused without a confirmation token", () => {
    resetStdioConfirmations()
    const refused = authorizeStdioSave({
      previous: [],
      next: [stdio("notes", "bash", ["-c", "id"])],
      token: "forged",
    })
    assert.equal(refused.ok, false)
    if (refused.ok) return
    assert.match(refused.error, /bash/)
    assert.equal(refused.confirm, undefined)
  })

  await t.test("changing only non-command fields does not need a token", () => {
    resetStdioConfirmations()
    const server = stdio("notes", "npx", ["-y", "notes-mcp"])
    const saved = authorizeStdioSave({
      previous: [{ ...server, enabled: true }],
      next: [{ ...server, enabled: false, env: { NOTES_TOKEN: "${ENV:NOTES_TOKEN}" } }],
    })
    assert.equal(saved.ok, true)
  })

  await t.test(
    "dangerous env is refused without a token, and the value is not echoed",
    () => {
      resetStdioConfirmations()
      const server = stdio("notes", "npx", ["-y", "notes-mcp"])
      const refused = authorizeStdioSave({
        previous: [server],
        next: [{ ...server, env: { NODE_OPTIONS: "--require /tmp/secret-evil.js" } }],
      })
      assert.equal(refused.ok, false)
      if (refused.ok) return
      assert.match(refused.error, /NODE_OPTIONS/)
      assert.equal(refused.error.includes("secret-evil"), false)
      assert.equal(refused.confirm, undefined)
    }
  )
})
