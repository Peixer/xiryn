import assert from "node:assert/strict"
import { test } from "node:test"

import { formatAudit } from "./audit"
import { redact } from "./redact"

test("progress and audit text do not keep secrets", () => {
  const raw =
    "OPENAI_API_KEY=sk-live failed Bearer abcdefghijklmnop AWS AKIAIOSFODNN7EXAMPLE"
  const cleaned = redact(raw)
  assert.doesNotMatch(cleaned, /sk-live/)
  assert.doesNotMatch(cleaned, /abcdefghijklmnop/)
  assert.doesNotMatch(cleaned, /AKIAIOSFODNN7EXAMPLE/)
  const line = formatAudit({
    ts: "2026-10-24T00:00:00.000Z",
    op: "switch",
    result: "failed",
    actor: "helper",
    sha: "a".repeat(40),
    active: "blue",
    candidate: "green",
    error: "TELEGRAM_BOT_TOKEN=123456:ABC",
  })
  assert.doesNotMatch(line, /123456:ABC/)
  assert.match(line, /\[redacted\]/)
})
