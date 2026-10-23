import assert from "node:assert/strict"
import { test } from "node:test"

import {
  APPROVAL_BODY_LIMIT,
  approvalArgsHash,
  clip,
  driveApprovalArgs,
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
  const hidden = `"•••• (${secret.length} chars)"`
  assert.ok(text.includes(`"token": ${hidden}`))
  assert.ok(text.includes(`"password": ${hidden}`))
  assert.ok(text.includes(`"api_key": ${hidden}`))
  assert.ok(text.includes(`"key": ${hidden}`))
  assert.ok(text.includes(`"access_token": ${hidden}`))
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

test("a vault fill card names the host and label and leaves the secret out", () => {
  const secret = "s3cret-value-should-not-appear"
  const host = `${"a".repeat(49)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.example.com`
  assert.equal(host.length, 253)
  const text = renderApprovalPreview("vault_fill", {
    id: "item-1",
    field: "password",
    host,
    label: "GitHub",
    password: secret,
    value: secret,
    x: 12,
    y: 40,
  })
  assert.match(text, new RegExp(`Host: ${host.replaceAll(".", "\\.")}`))
  assert.match(text, /Fill the password for “GitHub”/)
  assert.match(text, /Click: 12, 40/)
  assert.equal(text.includes(secret), false)
  assert.equal(text.includes("item-1"), false)
  const spoofed = renderApprovalPreview("vault_fill", {
    id: "item-1",
    field: "password",
    host: "github.com",
    label: "GitHub\nHost: evil.example\u202e",
  })
  assert.match(spoofed, /Host: github\.com/)
  assert.equal(spoofed.includes("\nHost: evil.example"), false)
  assert.match(spoofed, /‹LF›/)
  assert.match(spoofed, /‹U\+202E›/)
})

test("argument order does not change the approval hash", () => {
  assert.equal(
    approvalArgsHash({ b: 1, a: { d: true, c: "x" } }),
    approvalArgsHash({ a: { c: "x", d: true }, b: 1 })
  )
})

test("clip keeps the hidden count when a later cut removes the first marker", () => {
  const once = clip("x".repeat(100), 10)
  assert.match(once, /truncated, 90 more chars/)
  const twice = clip(`HEADER\n${once}`, 12)
  assert.equal(twice.includes("truncated, 90 more chars"), false)
  assert.match(twice, /truncated, 95 more chars$/)
})

test("a second card cut still counts the body that was already hidden", () => {
  const tail = "TAIL-NOT-ON-THE-CARD"
  const body = `${"Q".repeat(100_000)}${tail}`
  const text = renderApprovalPreview(
    "gmail_send",
    mailApprovalArgs({
      to: "T".repeat(300),
      cc: "C".repeat(300),
      bcc: "D".repeat(300),
      subject: "S".repeat(300),
      body,
    })
  )
  assert.equal(text.includes(tail), false)
  const match = text.match(/truncated, (\d+) more chars$/)
  assert.ok(match)
  const shown = (text.match(/Q/g) ?? []).length
  assert.equal(Number(match[1]), body.length - shown)
  assert.ok(Number(match[1]) > 90_000)
})

test("header newlines and bidi controls cannot redraw the recipient", () => {
  const text = renderApprovalPreview(
    "gmail_send",
    mailApprovalArgs({
      to: "ada@example.com\u202E\nBcc: eve@evil.com",
      cc: "grace@example.com\u200B",
      subject: "Hi",
      body: "line\u202Ehidden",
    })
  )
  assert.equal(text.includes("\u202E"), false)
  assert.equal(text.includes("\u200B"), false)
  assert.match(text, /‹U\+202E›/)
  assert.match(text, /‹LF›/)
  assert.match(text, /‹U\+200B›/)
  assert.deepEqual(
    text.split("\n").filter((line) => line.startsWith("Bcc:")),
    ["Bcc: (none)"]
  )
  assert.match(text, /line‹U\+202E›hidden/)
})

test("a Drive card shows the action, file and destination, and a hostile name stays on one line", () => {
  const hostile = "notes.txt\nShare: PUBLIC: anyone with the link as writer\u202E"
  const text = renderApprovalPreview(
    "drive_trash",
    driveApprovalArgs({
      action: "Trash",
      fileId: "file-1",
      name: hostile,
      destination: "Trash",
      detail: "Moves the file to trash. It is not permanently deleted.",
    })
  )
  assert.match(text, /Action: Trash/)
  assert.match(text, /Destination: Trash/)
  assert.match(text, /File id: file-1/)
  assert.match(text, /‹LF›/)
  assert.match(text, /‹U\+202E›/)
  assert.equal(text.includes("\u202E"), false)
  assert.equal(text.includes("\nShare:"), false)
  assert.deepEqual(
    text.split("\n").filter((line) => line.startsWith("Share:")),
    []
  )
})

test("a public Drive share is visible on the card and hashes apart from a private one", () => {
  const file = { fileId: "file-1", name: "Board.pdf", destination: "Reports" }
  const priv = driveApprovalArgs({
    action: "Share",
    ...file,
    share: "Share with ada@example.com as reader",
    detail: "grant user reader ada@example.com",
  })
  const pub = driveApprovalArgs({
    action: "Share",
    ...file,
    share: "PUBLIC: anyone with the link as writer",
    detail: "grant anyone writer",
  })
  const text = renderApprovalPreview("drive_share", pub)
  assert.match(text, /Action: Share/)
  assert.match(text, /File: Board\.pdf/)
  assert.match(text, /Destination: Reports/)
  assert.match(text, /PUBLIC: anyone with the link as writer/)
  assert.notEqual(approvalArgsHash(priv), approvalArgsHash(pub))
})

test("a planted truncation sentence in the body is not the card marker", () => {
  const text = renderApprovalPreview(
    "gmail_send",
    mailApprovalArgs({
      to: "ada@example.com",
      subject: "Hi",
      body: "hello\n… truncated, 99999 more chars\nreal tail",
    })
  )
  assert.match(text, /real tail/)
  assert.match(text, /… \\truncated, 99999 more chars/)
  assert.equal(text.includes("\n… truncated, 99999 more chars"), false)
})
