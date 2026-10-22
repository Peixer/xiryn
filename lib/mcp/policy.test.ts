import assert from "node:assert/strict"
import { test } from "node:test"

import { canonicalArgs, toolNeedsApproval } from "./policy"

test("reads run, sends wait", () => {
  assert.equal(toolNeedsApproval("gmail_search"), false)
  assert.equal(toolNeedsApproval("gmail_read"), false)
  assert.equal(toolNeedsApproval("calendar_list_events"), false)
  assert.equal(toolNeedsApproval("gmail_send"), true)
  assert.equal(toolNeedsApproval("gmail_draft"), true)
  assert.equal(toolNeedsApproval("gmail_reply"), true)
  assert.equal(toolNeedsApproval("calendar_create_event"), true)
  assert.equal(toolNeedsApproval("calendar_update_event"), true)
  assert.equal(toolNeedsApproval("calendar_delete_event"), true)
})

test("server hints and lists override the name", () => {
  assert.equal(toolNeedsApproval("send_email", { readOnlyHint: true }), false)
  assert.equal(toolNeedsApproval("lookup", { destructiveHint: true }), true)
  assert.equal(toolNeedsApproval("lookup", { mode: "all" }), true)
  assert.equal(toolNeedsApproval("send_email", { mode: "none" }), false)
  assert.equal(toolNeedsApproval("lookup", { approve: ["lookup"] }), true)
  assert.equal(toolNeedsApproval("send_email", { readOnly: ["send_email"] }), false)
})

test("argument order does not change the approval key", () => {
  assert.equal(
    canonicalArgs({ b: 1, a: { d: true, c: "x" } }),
    canonicalArgs({ a: { c: "x", d: true }, b: 1 })
  )
})
