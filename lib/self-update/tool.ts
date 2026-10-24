import { tool } from "ai"
import { z } from "zod"

import type { ToolEnv } from "@/lib/agent/tools"
import { requestOrTake } from "@/lib/mcp/approval"
import { SELF_UPDATE_TOOL } from "@/lib/self-update/approval-gate"
import type { HelperOp } from "@/lib/self-update/allowlist"
import { buildSelfUpdateArgs, submitSelfUpdate } from "@/lib/self-update/submit"
import { deployDir, loadSelfUpdateView, readDeployState } from "@/lib/self-update/status"

// Agents can ask. The first call always becomes an approval card. A switch
// or roll back runs only after the owner approves and the tool is called again
// with the same action.
export function createSelfUpdateTools(env: ToolEnv) {
  return {
    request_self_update: tool({
      description:
        "Ask the owner to update Xiryn, switch to a version that is already built, or roll back to the previous colour. " +
        "Call it once and stop. Nothing is installed or switched until they approve. " +
        "If they approve, call it again with the same action. You cannot choose a commit, branch, or ref.",
      inputSchema: z.object({
        action: z
          .enum(["update", "switch", "rollback"])
          .describe(
            "update builds the inactive colour. switch and rollback change which colour is live."
          ),
      }),
      execute: async ({ action }) => {
        const op: HelperOp =
          action === "update" ? "prepare" : action === "switch" ? "switch" : "rollback"
        const view = loadSelfUpdateView()
        const state = readDeployState()
        const sha =
          op === "prepare"
            ? view.tipSha
            : op === "switch"
              ? state.candidateSha
              : state.previousSha
        if (!view.configured) {
          return {
            status: "unavailable" as const,
            reason: "Self-update is not installed on this machine.",
          }
        }
        if (!sha) {
          return {
            status: "unavailable" as const,
            reason: "There is no pinned commit for that action.",
          }
        }
        const args = buildSelfUpdateArgs(state, op, sha)
        // Leave the row approved. The helper marks it used, so a second inbox
        // file with the same id is refused even inside the 20-minute window.
        const gate = requestOrTake({
          threadId: env.threadId,
          agentId: env.current().id,
          tool: SELF_UPDATE_TOOL,
          summary: action,
          args,
          consume: false,
        })
        if (gate.kind === "rejected") {
          return { status: "rejected" as const, reason: gate.reason }
        }
        if (gate.kind === "hold") {
          await env.onActionRequested?.(env.current(), gate.approval)
          return {
            status: "needs-approval" as const,
            approvalId: gate.approval.id,
            summary: gate.approval.summary,
          }
        }
        const approved = gate.approval
        if (!approved || approved.status !== "approved") {
          return {
            status: "refused" as const,
            reason: "This needs the owner's approval.",
          }
        }
        const result = submitSelfUpdate({
          deployDir: deployDir(),
          state,
          op,
          actor: "agent",
          tip: view.tipSha,
          approval: {
            tool: approved.tool,
            args: approved.args,
            argsHash: approved.argsHash,
            status: approved.status,
            expiresAt: approved.expiresAt ? approved.expiresAt.getTime() : null,
          },
          approvalId: approved.id,
          now: Date.now(),
        })
        if (!result.ok) return { status: "refused" as const, reason: result.error }
        return {
          status: "queued" as const,
          action,
          sha,
          note: "The helper will do this outside this process. Do not claim it has finished.",
        }
      },
    }),
  }
}
