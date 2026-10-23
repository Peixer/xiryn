import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isSensitiveKey,
  messagesForOfflineStore,
  redactText,
  redactValue,
} from "./sanitize"

test("secret-shaped keys and bearer tokens are not stored on the device", () => {
  assert.equal(isSensitiveKey("api_key"), true)
  assert.equal(isSensitiveKey("password"), true)
  assert.equal(isSensitiveKey("access_token"), true)
  assert.equal(isSensitiveKey("title"), false)
  assert.equal(
    redactText("Authorization: Bearer abc.def and sk-live-12345678"),
    "Authorization: Bearer [redacted] and [redacted]"
  )
  assert.deepEqual(
    redactValue({ token: "raw", note: "Bearer xyz", nested: { password: "p" } }),
    {
      token: "••••",
      note: "Bearer [redacted]",
      nested: { password: "••••" },
    }
  )
})

test("offline messages keep text and hide vault and approval tools", () => {
  const stored = messagesForOfflineStore([
    {
      id: "1",
      role: "user",
      parts: [
        { type: "text", text: "Hello" },
        { type: "data-attachment", data: { name: "photo.png" } },
      ],
    },
    {
      id: "2",
      role: "assistant",
      parts: [
        { type: "text", text: "Use Bearer super-secret-token please" },
        { type: "tool-vault_fill", toolName: "vault_fill", output: { password: "nope" } },
        { type: "tool-web_search", toolName: "web_search", output: { token: "nope" } },
        {
          type: "tool-request_approval",
          toolName: "request_approval",
          output: { hash: "abc" },
        },
      ],
    },
  ])
  assert.equal(stored[0]?.text, "Hello\n[file: photo.png]")
  assert.equal(stored[1]?.text.includes("super-secret-token"), false)
  assert.equal(stored[1]?.text.includes("nope"), false)
  assert.equal(stored[1]?.text.includes("vault_fill: hidden on this device"), true)
  assert.equal(stored[1]?.text.includes("[web_search]"), true)
  assert.equal(stored[1]?.text.includes("request_approval: hidden on this device"), true)
  assert.equal("output" in (stored[1] ?? {}), false)
})
