import type { ToolEnv } from "@/lib/agent/tools"
import { requestOrTake } from "@/lib/mcp/approval"

// Returns a hold payload when the person has not approved this exact call.
// The caller must not perform the action in that case.
export async function holdOrRun(
  env: ToolEnv,
  spec: { tool: string; summary: string; args: unknown }
) {
  const gate = requestOrTake({
    threadId: env.threadId,
    agentId: env.current().id,
    tool: spec.tool,
    args: spec.args,
    summary: spec.summary,
  })
  if (gate.kind === "run") return null
  await env.onActionRequested?.(env.current(), gate.approval)
  return {
    status: "needs-approval" as const,
    approvalId: gate.approval.id,
    summary: gate.approval.summary,
  }
}
