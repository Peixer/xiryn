import {
  gateSelfUpdate,
  publicOp,
  type SelfUpdateArgs,
} from "@/lib/self-update/approval-gate"
import type { HelperOp, HelperRequest } from "@/lib/self-update/allowlist"
import { enqueueRequest } from "@/lib/self-update/queue"
import { isSha } from "@/lib/self-update/sha"
import type { DeployState } from "@/lib/self-update/state"
import type { GateApproval } from "@/lib/self-update/approval-gate"

export function opAllowed(
  state: DeployState,
  op: HelperOp
): { ok: true } | { ok: false; reason: string } {
  if (op === "status") return { ok: true }
  if (op === "prepare") {
    if (state.phase === "building" || state.phase === "switching") {
      return { ok: false, reason: "An update is already in progress." }
    }
    return { ok: true }
  }
  if (op === "switch") {
    if (
      (state.phase === "ready" || state.phase === "rolled_back") &&
      state.candidateSha
    ) {
      return { ok: true }
    }
    return { ok: false, reason: "There is no prepared version to switch to." }
  }
  if (state.phase === "active" && state.previousSha) return { ok: true }
  return { ok: false, reason: "There is no previous version to roll back to." }
}

export function targetSha(state: DeployState, op: HelperOp, tip: string | null) {
  if (op === "prepare" || op === "status") return tip
  if (op === "switch") return state.candidateSha
  return state.previousSha
}

export function buildSelfUpdateArgs(
  state: DeployState,
  op: HelperOp,
  sha: string
): SelfUpdateArgs {
  const to =
    op === "rollback"
      ? (state.previous ?? state.active)
      : op === "prepare" || op === "status"
        ? state.active === "blue"
          ? "green"
          : "blue"
        : (state.candidate ?? state.active)
  return {
    op: publicOp(op === "status" ? "prepare" : op),
    sha,
    from: state.active,
    to,
    branch: state.branch,
  }
}

// Owner update skips approval. Switch, roll back, and agent updates do not.
export function submitSelfUpdate(input: {
  deployDir: string
  state: DeployState
  op: HelperOp
  actor: "owner" | "agent"
  tip: string | null
  approval: GateApproval | null
  approvalId: string | null
  now: number
}): { ok: true; request: HelperRequest } | { ok: false; error: string } {
  const allowed = opAllowed(input.state, input.op)
  if (!allowed.ok) return { ok: false, error: allowed.reason }
  const sha = targetSha(input.state, input.op, input.tip)
  if (input.op !== "status" && (!sha || !isSha(sha))) {
    return { ok: false, error: "There is no pinned commit for that action." }
  }
  const expected = buildSelfUpdateArgs(input.state, input.op, sha ?? "0".repeat(40))
  const gateOp = input.op === "status" ? "prepare" : input.op
  const gate = gateSelfUpdate({
    op: gateOp,
    actor: input.actor,
    approval: input.approval,
    expected,
    now: input.now,
  })
  if (!gate.allow) return { ok: false, error: gate.reason }
  const request: HelperRequest = {
    op: input.op,
    sha: input.op === "status" ? null : sha,
    approvalId:
      input.op === "prepare" && input.actor === "owner" ? null : input.approvalId,
    actor: input.actor,
    requestedAt: new Date(input.now).toISOString(),
  }
  if (
    (input.op === "switch" ||
      input.op === "rollback" ||
      (input.op === "prepare" && input.actor === "agent")) &&
    !request.approvalId
  ) {
    return { ok: false, error: "This needs the owner's approval." }
  }
  try {
    enqueueRequest(input.deployDir, request)
  } catch {
    return {
      ok: false,
      error: "Could not queue the request. The deploy directory is not writable.",
    }
  }
  return { ok: true, request }
}
