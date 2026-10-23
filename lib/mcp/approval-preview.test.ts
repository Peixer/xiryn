import assert from "node:assert/strict"
import { test } from "node:test"

import {
  APPROVAL_BODY_LIMIT,
  approvalArgsHash,
  eventApprovalArgs,
  isSecretKey,
  mailApprovalArgs,
  renderApprovalPreview,
} from "./approval-preview"

const mail = mailApprovalArgs({
  to: "ada@example.com",
  cc: "grace@example.com",
  bcc: "hidden@example.com",
  subject: "Quarterly notes",
  body: "The board packet is attached.\nPlease do not forward it.",
})

test("gmail card text includes recipients, subject, and body", () => {
  for (const tool of ["gmail_send", "gmail_draft", "gmail_reply"] as const) {
    const text = renderApprovalPreview(tool, mail)
    assert.match(text, /To: ada@example.com/)
    assert.match(text, /Cc: grace@example.com/)
    assert.match(text, /Bcc: hidden@example.com/)
    assert.match(text, /Subject: Quarterly notes/)
    assert.match(text, /The board packet is attached\./)
    assert.match(text, /Please do not forward it\./)
  }
})

test("a long body keeps a visible truncation marker and hides nothing silently", () => {
  const tail = "TAIL-NOT-ON-THE-CARD"
  const body = `visible start ${"x".repeat(APPROVAL_BODY_LIMIT)}${tail}`
  const text = renderApprovalPreview(
    "gmail_send",
    mailApprovalArgs({
      to: "ada@example.com",
      subject: "Long",
      body,
    })
  )
  const omitted = body.length - APPROVAL_BODY_LIMIT
  assert.match(text, new RegExp(`truncated, ${omitted} more chars`))
  assert.match(text, /visible start/)
  assert.equal(text.includes(tail), false)
  assert.match(text, /To: ada@example.com/)
  assert.match(text, /Cc: \(none\)/)
  assert.match(text, /Bcc: \(none\)/)
})

test("calendar cards show title, time, and attendees", () => {
  const args = eventApprovalArgs({
    id: "evt-1",
    summary: "Design review",
    start: { dateTime: "2026-10-23T09:00:00", timeZone: "Europe/Lisbon" },
    end: { dateTime: "2026-10-23T09:30:00", timeZone: "Europe/Lisbon" },
    attendees: ["ada@example.com", "grace@example.com"],
  })
  const text = renderApprovalPreview("calendar_create_event", args)
  assert.match(text, /Title: Design review/)
  assert.match(text, /2026-10-23T09:00:00 Europe\/Lisbon/)
  assert.match(text, /2026-10-23T09:30:00 Europe\/Lisbon/)
  assert.match(text, /Attendees: ada@example.com, grace@example.com/)
  assert.match(text, /Event: evt-1/)
})

test("a delete shows the event on the calendar, not a title the model invented", () => {
  const args = eventApprovalArgs(
    { id: "evt-9", summary: "Innocent standup" },
    {
      summary: "Board meeting",
      start: { dateTime: "2026-10-23T16:00:00", timeZone: "Europe/Lisbon" },
      end: { dateTime: "2026-10-23T17:00:00", timeZone: "Europe/Lisbon" },
      attendees: [{ email: "ada@example.com" }],
    },
    { preferCurrent: true }
  )
  const text = renderApprovalPreview("calendar_delete_event", args)
  assert.match(text, /Title: Board meeting/)
  assert.equal(text.includes("Innocent standup"), false)
  assert.match(text, /Attendees: ada@example.com/)
})

test("secret-looking MCP argument keys are masked and the tool name is shown", () => {
  assert.equal(isSecretKey("token"), true)
  assert.equal(isSecretKey("password"), true)
  assert.equal(isSecretKey("api_key"), true)
  assert.equal(isSecretKey("apiKey"), true)
  assert.equal(isSecretKey("key"), true)
  assert.equal(isSecretKey("keyboard"), false)
  const secret = "s3cret-value-should-not-appear"
  const text = renderApprovalPreview("mcp_docs_create_page", {
    title: "Notes",
    token: secret,
    auth: { password: secret, api_key: secret },
    key: secret,
    nested: [{ access_token: secret, query: "keep-this-query" }],
  })
  assert.match(text, /Tool: mcp_docs_create_page/)
  assert.match(text, /"title": "Notes"/)
  assert.match(text, /"token": "••••"/)
  assert.match(text, /"password": "••••"/)
  assert.match(text, /"api_key": "••••"/)
  assert.match(text, /"key": "••••"/)
  assert.match(text, /"access_token": "••••"/)
  assert.match(text, /keep-this-query/)
  assert.equal(text.includes(secret), false)
  assert.match(text, /\{/)
})

test("a long MCP argument blob is truncated with the same marker", () => {
  const tail = "MCP-TAIL-NOT-SHOWN"
  const blob = `${"y".repeat(APPROVAL_BODY_LIMIT)}${tail}`
  const text = renderApprovalPreview("mcp_docs_write", { note: blob })
  assert.match(text, /Tool: mcp_docs_write/)
  assert.match(text, /truncated, \d+ more chars/)
  assert.equal(text.includes(tail), false)
})

test("argument order does not change the approval hash", () => {
  assert.equal(
    approvalArgsHash({ b: 1, a: { d: true, c: "x" } }),
    approvalArgsHash({ a: { c: "x", d: true }, b: 1 })
  )
})
