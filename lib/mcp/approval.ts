import { and, eq } from "drizzle-orm"

import { db } from "@/db"
import { actionApprovals } from "@/db/schema"
import { canonicalArgs } from "@/lib/mcp/policy"

// Twenty minutes, the same window a payment approval stays usable.
const TTL_MS = 20 * 60_000

export type ActionApproval = typeof actionApprovals.$inferSelect

export function requestOrTake(input: {
  threadId: string
  agentId: string | null
  tool: string
  args: unknown
  summary: string
}) {
  const args = canonicalArgs(input.args)
  const now = new Date()
  const reusable = db
    .select()
    .from(actionApprovals)
    .where(
      and(
        eq(actionApprovals.threadId, input.threadId),
        eq(actionApprovals.tool, input.tool),
        eq(actionApprovals.args, args)
      )
    )
    .all()
    .filter((row) => !row.expiresAt || row.expiresAt.getTime() > now.getTime())

  const approved = reusable.find((row) => row.status === "approved")
  if (approved) {
    db.update(actionApprovals)
      .set({ status: "used", decidedAt: approved.decidedAt ?? now })
      .where(eq(actionApprovals.id, approved.id))
      .run()
    return { kind: "run" as const }
  }

  const pending = reusable.find((row) => row.status === "pending")
  if (pending) return { kind: "hold" as const, approval: pending }

  const [approval] = db
    .insert(actionApprovals)
    .values({
      threadId: input.threadId,
      agentId: input.agentId,
      tool: input.tool,
      args,
      summary: input.summary.slice(0, 300),
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
  if (choice === "decline") {
    return {
      text: `I've declined this: ${row.summary}. Don't do it, and don't ask again unless I bring it up.`,
      marker: { action: "declined" as const, summary: row.summary },
    }
  }
  return {
    text: `Approved: ${row.summary}. Call ${row.tool} again with the same arguments. That call will go through; do not change them.`,
    marker: { action: "approved" as const, summary: row.summary },
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
