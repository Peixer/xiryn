import assert from "node:assert/strict"
import { test } from "node:test"

import { approvalArgsHash } from "@/lib/mcp/approval-preview"
import { canonicalArgs } from "@/lib/mcp/policy"

import { gateSelfUpdate, type SelfUpdateArgs } from "./approval-gate"

const args: SelfUpdateArgs = {
  op: "switch",
  sha: "c".repeat(40),
  from: "blue",
  to: "green",
  branch: "main",
}

function approval(over: Partial<{ status: string; args: unknown; tool: string }> = {}) {
  const payload = over.args ?? args
  return {
    tool: over.tool ?? "request_self_update",
    args: typeof payload === "string" ? payload : canonicalArgs(payload),
    argsHash: approvalArgsHash(payload),
    status: over.status ?? "approved",
    expiresAt: Date.now() + 60_000,
  }
}

test("the owner can start an update without an approval card", () => {
  assert.deepEqual(
    gateSelfUpdate({
      op: "prepare",
      actor: "owner",
      approval: null,
      expected: { ...args, op: "update" },
      now: Date.now(),
    }),
    { allow: true }
  )
})

test("an agent update and every switch or rollback need a matching approval", () => {
  const now = Date.now()
  assert.equal(
    gateSelfUpdate({
      op: "prepare",
      actor: "agent",
      approval: null,
      expected: { ...args, op: "update" },
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "owner",
      approval: null,
      expected: args,
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "rollback",
      actor: "owner",
      approval: approval({ args: { ...args, op: "rollback" } }),
      expected: { ...args, op: "rollback" },
      now,
    }).allow,
    true
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "agent",
      approval: approval({ status: "pending" }),
      expected: args,
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "agent",
      approval: approval({ status: "declined" }),
      expected: args,
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "owner",
      approval: approval({ args: { ...args, sha: "d".repeat(40) } }),
      expected: args,
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "owner",
      approval: { ...approval(), expiresAt: now - 1 },
      expected: args,
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "owner",
      approval: approval({ status: "used" }),
      expected: args,
      now,
    }).allow,
    false
  )
  assert.equal(
    gateSelfUpdate({
      op: "switch",
      actor: "owner",
      approval: approval(),
      expected: args,
      now,
    }).allow,
    true
  )
})
