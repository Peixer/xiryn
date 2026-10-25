"use server"

import { eq } from "drizzle-orm"

import { db } from "@/db"
import { actionApprovals, threads } from "@/db/schema"
import { decideAction, getActionApproval, requestOrTake } from "@/lib/mcp/approval"
import { SELF_UPDATE_TOOL, type SelfUpdateArgs } from "@/lib/self-update/approval-gate"
import type { HelperOp } from "@/lib/self-update/allowlist"
import { formatDiscardImpact, loadDiscardImpact } from "@/lib/self-update/discard"
import { assertRollbackConfirmation } from "@/lib/self-update/rollback-confirm"
import { buildSelfUpdateArgs, submitSelfUpdate } from "@/lib/self-update/submit"
import { deployDir, loadSelfUpdateView, readDeployState } from "@/lib/self-update/status"

function systemThread() {
  const existing = db
    .select()
    .from(threads)
    .where(eq(threads.preview, "xiryn:self-update"))
    .get()
  if (existing) return existing.id
  const [row] = db
    .insert(threads)
    .values({
      title: "Self-update",
      preview: "xiryn:self-update",
      ephemeral: true,
    })
    .returning()
    .all()
  return row.id
}

function currentArgs(
  op: HelperOp
): { args: SelfUpdateArgs; tip: string | null } | { error: string } {
  const view = loadSelfUpdateView()
  const state = readDeployState()
  const sha =
    op === "prepare"
      ? view.tipSha
      : op === "switch"
        ? state.candidateSha
        : state.previousSha
  if (!sha) return { error: "There is no pinned commit for that action." }
  return { args: buildSelfUpdateArgs(state, op, sha), tip: view.tipSha }
}

function queue(op: "switch" | "rollback" | "prepare", approvalId: string) {
  const view = loadSelfUpdateView()
  const stored = db
    .select()
    .from(actionApprovals)
    .where(eq(actionApprovals.id, approvalId))
    .get()
  if (!stored) return { ok: false as const, error: "That approval no longer exists." }
  return submitSelfUpdate({
    deployDir: deployDir(),
    state: readDeployState(),
    op,
    actor: "owner",
    tip: view.tipSha,
    approval: {
      tool: stored.tool,
      args: stored.args,
      argsHash: stored.argsHash,
      status: stored.status,
      expiresAt: stored.expiresAt ? stored.expiresAt.getTime() : null,
    },
    approvalId: stored.id,
    now: Date.now(),
  })
}

export async function startSelfUpdate() {
  const view = loadSelfUpdateView()
  if (!view.configured) {
    return {
      ok: false as const,
      error: "Self-update is not installed. See docs/self-update.md.",
    }
  }
  const built = currentArgs("prepare")
  if ("error" in built) return { ok: false as const, error: built.error }
  const result = submitSelfUpdate({
    deployDir: deployDir(),
    state: readDeployState(),
    op: "prepare",
    actor: "owner",
    tip: built.tip,
    approval: null,
    approvalId: null,
    now: Date.now(),
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const }
}

export async function stageSelfUpdate(op: "switch" | "rollback") {
  const built = currentArgs(op)
  if ("error" in built) return { ok: false as const, error: built.error }
  const threadId = systemThread()
  const gate = requestOrTake({
    threadId,
    agentId: null,
    tool: SELF_UPDATE_TOOL,
    args: built.args,
    consume: false,
  })
  if (gate.kind === "rejected") return { ok: false as const, error: gate.reason }
  if (gate.kind === "run") {
    if (!gate.approval || gate.approval.status !== "approved") {
      return { ok: false as const, error: "That approval no longer exists." }
    }
    const result = queue(op, gate.approval.id)
    if (!result.ok) return result
    return { ok: true as const, queued: true as const }
  }
  return {
    ok: true as const,
    approvalId: gate.approval.id,
    summary: gate.approval.summary,
    impact: op === "rollback" ? formatDiscardImpact(loadDiscardImpact()) : null,
  }
}

function storedOp(args: string) {
  try {
    const parsed = JSON.parse(args) as { op?: unknown }
    return typeof parsed.op === "string" ? parsed.op : null
  } catch {
    return null
  }
}

export async function decideSelfUpdate(
  approvalId: string,
  choice: "approve" | "decline",
  op: "switch" | "rollback",
  confirmDiscard?: boolean
) {
  try {
    if (choice === "decline") {
      decideAction(approvalId, "declined")
      return { ok: true as const, queued: false as const }
    }
    const pending = getActionApproval(approvalId)
    if (!pending || pending.tool !== SELF_UPDATE_TOOL) {
      return { ok: false as const, error: "That approval is not for a version change." }
    }
    if (pending.status === "used") {
      return { ok: false as const, error: "This approval was already used." }
    }
    if (storedOp(pending.args) !== op) {
      return { ok: false as const, error: "That approval is not for this action." }
    }
    const refused = assertRollbackConfirmation(op, confirmDiscard)
    if (refused) return { ok: false as const, error: refused }
    if (pending.status === "pending") decideAction(approvalId, "approved")
    else if (pending.status !== "approved") {
      return { ok: false as const, error: "Approve this exact version first." }
    }
    const built = currentArgs(op)
    if ("error" in built) return { ok: false as const, error: built.error }
    const gate = requestOrTake({
      threadId: pending.threadId,
      agentId: null,
      tool: SELF_UPDATE_TOOL,
      args: built.args,
      consume: false,
    })
    if (gate.kind !== "run" || !gate.approval) {
      return { ok: false as const, error: "Approve this exact version first." }
    }
    const result = queue(op, gate.approval.id)
    if (!result.ok) return result
    return { ok: true as const, queued: true as const }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not record that decision."
    return { ok: false as const, error: message }
  }
}
