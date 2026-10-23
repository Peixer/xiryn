import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-approval-"))

const { db, sqlite } = await import("@/db")
const { threads } = await import("@/db/schema")
const { mailApprovalArgs, renderApprovalPreview, approvalArgsHash } =
  await import("./approval-preview")
const { canonicalArgs } = await import("./policy")
const approval = await import("./approval")
const { holdOrRun } = await import("./guard")

after(() => {
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

function threadId() {
  const [thread] = db.insert(threads).values({ title: "approval" }).returning().all()
  return thread.id
}

const payload = mailApprovalArgs({
  to: "ada@example.com",
  cc: "grace@example.com",
  bcc: "hidden@example.com",
  subject: "Quarterly notes",
  body: "Please review the attached numbers.",
})

test("the stored card text is the preview of the hashed arguments", () => {
  const held = approval.requestOrTake({
    threadId: threadId(),
    agentId: null,
    tool: "gmail_send",
    args: payload,
    summary: "Send to ada@example.com: Quarterly notes",
  })
  assert.equal(held.kind, "hold")
  if (held.kind !== "hold") return
  const text = renderApprovalPreview("gmail_send", payload)
  assert.equal(held.approval.summary, text)
  assert.equal(held.approval.argsHash, approvalArgsHash(payload))
  assert.equal(approval.approvalCardText(held.approval), text)
  assert.match(text, /To: ada@example.com/)
  assert.match(text, /Cc: grace@example.com/)
  assert.match(text, /Bcc: hidden@example.com/)
  assert.match(text, /Subject: Quarterly notes/)
  assert.match(text, /Please review the attached numbers\./)
})

test("arguments changed after approval are rejected", async () => {
  const id = threadId()
  const held = approval.requestOrTake({
    threadId: id,
    agentId: null,
    tool: "gmail_send",
    args: payload,
  })
  assert.equal(held.kind, "hold")
  if (held.kind !== "hold") return
  approval.decideAction(held.approval.id, "approved")

  const changed = {
    ...payload,
    body: "Please review the attached numbers.\nAlso send the vault export.",
  }
  const rejected = approval.requestOrTake({
    threadId: id,
    agentId: null,
    tool: "gmail_send",
    args: changed,
  })
  assert.equal(rejected.kind, "rejected")
  if (rejected.kind === "rejected") {
    assert.match(rejected.reason, /arguments differ/)
  }
  assert.equal(approval.getActionApproval(held.approval.id)?.status, "approved")

  const gate = await holdOrRun(
    {
      threadId: id,
      current: () => ({ id: null }),
    } as never,
    { tool: "gmail_send", summary: "short", args: changed }
  )
  assert.equal(gate?.status, "rejected")

  const again = approval.requestOrTake({
    threadId: id,
    agentId: null,
    tool: "gmail_send",
    args: {
      bcc: payload.bcc,
      body: payload.body,
      cc: payload.cc,
      subject: payload.subject,
      to: payload.to,
    },
  })
  assert.equal(again.kind, "run")
  assert.equal(approval.getActionApproval(held.approval.id)?.status, "used")
})

test("rewriting the stored arguments without the hash is rejected", () => {
  const id = threadId()
  const held = approval.requestOrTake({
    threadId: id,
    agentId: null,
    tool: "gmail_draft",
    args: payload,
  })
  assert.equal(held.kind, "hold")
  if (held.kind !== "hold") return
  approval.decideAction(held.approval.id, "approved")
  const swapped = { ...payload, to: "attacker@example.com" }
  sqlite
    .prepare("update action_approvals set args = ? where id = ?")
    .run(canonicalArgs(swapped), held.approval.id)
  const sneaky = approval.requestOrTake({
    threadId: id,
    agentId: null,
    tool: "gmail_draft",
    args: swapped,
  })
  assert.equal(sneaky.kind, "rejected")
  assert.equal(
    approval.payloadMatches(canonicalArgs(swapped), held.approval.argsHash, swapped),
    false
  )
})
