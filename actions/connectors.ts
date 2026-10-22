"use server"

import { revalidatePath } from "next/cache"

import { answerAction, getActionApproval } from "@/lib/mcp/approval"
import { writeMcpConfig } from "@/lib/mcp/config"
import { disconnectGoogle } from "@/lib/mcp/google"
import { resetMcpClients } from "@/lib/mcp/load"

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function saveMcpConfig(text: string) {
  try {
    writeMcpConfig(text.trim() ? text : '{"servers":[]}\n')
    resetMcpClients()
    revalidatePath("/", "layout")
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

export async function connectorAction(approvalId: string) {
  const approval = getActionApproval(approvalId)
  if (!approval) return null
  return {
    id: approval.id,
    tool: approval.tool,
    summary: approval.summary,
    status: approval.status,
  }
}

export async function decideConnectorAction(
  approvalId: string,
  choice: "approve" | "decline"
) {
  try {
    const answer = answerAction(approvalId, choice)
    const { closeActionNotice } = await import("@/lib/telegram/bridge")
    await closeActionNotice(
      approvalId,
      choice === "approve"
        ? `Approved · ${answer.marker.summary}`
        : `Declined · ${answer.marker.summary}`
    ).catch(() => {})
    return { ok: true as const, text: answer.text, marker: answer.marker }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

export async function disconnectGoogleAccount() {
  disconnectGoogle()
  revalidatePath("/", "layout")
  return { ok: true as const }
}
