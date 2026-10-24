import { approvalArgsHash } from "@/lib/mcp/approval-preview"
import { canonicalArgs } from "@/lib/mcp/policy"
import type { Colour } from "@/lib/self-update/state"

export const SELF_UPDATE_TOOL = "request_self_update"

export type SelfUpdateOp = "prepare" | "switch" | "rollback"

export type SelfUpdateArgs = {
  op: "update" | "switch" | "rollback"
  sha: string
  from: Colour
  to: Colour
  branch: string
}

export type GateApproval = {
  tool: string
  args: unknown
  argsHash: string
  status: string
  expiresAt: number | null
}

// Update from the owner is the Settings button. Switch, roll back, and any
// agent request stay behind the same hash-bound approval as other writes.
export function gateSelfUpdate(input: {
  op: SelfUpdateOp
  actor: "owner" | "agent"
  approval: GateApproval | null
  expected: SelfUpdateArgs
  now: number
}): { allow: true } | { allow: false; reason: string } {
  if (input.op === "prepare" && input.actor === "owner") return { allow: true }
  const approval = input.approval
  if (!approval) return { allow: false, reason: "This needs the owner's approval." }
  if (approval.tool !== SELF_UPDATE_TOOL) {
    return { allow: false, reason: "The approval is for a different action." }
  }
  if (approval.status === "used") {
    return { allow: false, reason: "This approval was already used." }
  }
  if (approval.status !== "approved") {
    return { allow: false, reason: "The owner has not approved this." }
  }
  if (approval.expiresAt !== null && approval.expiresAt <= input.now) {
    return { allow: false, reason: "The approval expired." }
  }
  const expectedHash = approvalArgsHash(input.expected)
  if (approval.argsHash !== expectedHash) {
    return { allow: false, reason: "The approval does not match this version." }
  }
  let parsed: unknown
  try {
    parsed = typeof approval.args === "string" ? JSON.parse(approval.args) : approval.args
  } catch {
    return { allow: false, reason: "The approval does not match this version." }
  }
  if (canonicalArgs(parsed) !== canonicalArgs(input.expected)) {
    return { allow: false, reason: "The approval does not match this version." }
  }
  if (approvalArgsHash(parsed) !== approval.argsHash) {
    return { allow: false, reason: "The approval does not match this version." }
  }
  return { allow: true }
}

export function publicOp(op: SelfUpdateOp): SelfUpdateArgs["op"] {
  return op === "prepare" ? "update" : op
}
