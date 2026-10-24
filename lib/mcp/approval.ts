import { and, eq } from "drizzle-orm"

import { db } from "@/db"
import { actionApprovals } from "@/db/schema"
import {
  approvalArgsHash,
  approvalHeadline,
  renderApprovalPreview,
} from "@/lib/mcp/approval-preview"
import { canonicalArgs } from "@/lib/mcp/policy"

// Twenty minutes, the same window a payment approval stays usable.
const TTL_MS = 20 * 60_000

export const ARGS_DIFFER_REASON =
  "Refused: arguments differ from the approved action. Call again with the same arguments that were approved."

export type ActionApproval = typeof actionApprovals.$inferSelect

// True only when the call is byte-for-byte the payload that was hashed.
export function payloadMatches(storedArgs: string, storedHash: string, args: unknown) {
  if (storedArgs !== canonicalArgs(args)) return false
  const hash = approvalArgsHash(args)
  if (!storedHash) return true
  if (storedHash !== hash) return false
  try {
    return approvalArgsHash(JSON.parse(storedArgs)) === storedHash
  } catch {
    return false
  }
}

// Card and Telegram text, recomputed from the stored arguments so a short
// summary cannot drift away from the payload that will run.
export function approvalCardText(approval: {
  tool: string
  args: string
  summary: string
}) {
  try {
    return renderApprovalPreview(approval.tool, JSON.parse(approval.args))
  } catch {
    return approval.summary
  }
}

export function requestOrTake(input: {
  threadId: string
  agentId: string | null
  tool: string
  args: unknown
  summary?: string
  // Self-update leaves the row approved until the helper consumes it.
  // Every other tool still marks the row used as soon as it may run.
  consume?: boolean
}) {
  const canonical = canonicalArgs(input.args)
  const argsHash = approvalArgsHash(input.args)
  if (approvalArgsHash(JSON.parse(canonical)) !== argsHash) {
    return { kind: "rejected" as const, reason: ARGS_DIFFER_REASON }
  }
  const now = new Date()
  const open = db
    .select()
    .from(actionApprovals)
    .where(
      and(
        eq(actionApprovals.threadId, input.threadId),
        eq(actionApprovals.tool, input.tool)
      )
    )
    .all()
    .filter(
      (row) =>
        (row.status === "pending" || row.status === "approved") &&
        (!row.expiresAt || row.expiresAt.getTime() > now.getTime())
    )

  const approved = open.find(
    (row) =>
      row.status === "approved" && payloadMatches(row.args, row.argsHash, input.args)
  )
  if (approved) {
    if (input.consume === false) return { kind: "run" as const, approval: approved }
    db.update(actionApprovals)
      .set({ status: "used", decidedAt: approved.decidedAt ?? now })
      .where(eq(actionApprovals.id, approved.id))
      .run()
    return { kind: "run" as const }
  }

  const pending = open.find(
    (row) =>
      row.status === "pending" && payloadMatches(row.args, row.argsHash, input.args)
  )
  if (pending) return { kind: "hold" as const, approval: pending }

  // An approved call is still waiting. A different payload must not run as
  // that approval, and must not replace it.
  if (open.some((row) => row.status === "approved")) {
    return { kind: "rejected" as const, reason: ARGS_DIFFER_REASON }
  }

  const summary = renderApprovalPreview(input.tool, input.args)
  const [approval] = db
    .insert(actionApprovals)
    .values({
      threadId: input.threadId,
      agentId: input.agentId,
      tool: input.tool,
      args: canonical,
      argsHash,
      summary,
      status: "pending",
      expiresAt: new Date(now.getTime() + TTL_MS),
    })
    .returning()
    .all()
  return { kind: "hold" as const, approval }
}

export function getActionApproval(id: string) {
  return db.select().from(actionApprovals).where(eq(actionApprovals.id, id)).get() ?? null
}

export function answerAction(id: string, choice: "approve" | "decline") {
  const row = decideAction(id, choice === "approve" ? "approved" : "declined")
  const headline = approvalHeadline(approvalCardText(row))
  if (choice === "decline") {
    return {
      text: `I've declined this: ${headline}. Don't do it, and don't ask again unless I bring it up.`,
      marker: { action: "declined" as const, summary: headline },
    }
  }
  return {
    text: `Approved: ${headline}. Call ${row.tool} again with the same arguments. That call will go through; do not change them.`,
    marker: { action: "approved" as const, summary: headline },
  }
}

export function decideAction(id: string, status: "approved" | "declined") {
  const row = getActionApproval(id)
  if (!row) throw new Error("That request no longer exists.")
  if (row.status !== "pending") throw new Error("That request was already decided.")
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new Error("That request expired. Ask the agent to try again.")
  }
  db.update(actionApprovals)
    .set({ status, decidedAt: new Date() })
    .where(eq(actionApprovals.id, id))
    .run()
  return getActionApproval(id)!
}
