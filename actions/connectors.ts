"use server"

import { revalidatePath } from "next/cache"

import {
  addAllowlistHost,
  parseWebApprovalMode,
  webApprovalCardFields,
} from "@/lib/agent/untrusted"
import { getSetting, setSetting } from "@/lib/config"
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
  const card = webApprovalCardFields({
    tool: approval.tool,
    args: approval.args,
    summary: approval.summary,
    mode: parseWebApprovalMode(getSetting("security.webApproval")),
  })
  return {
    id: approval.id,
    tool: approval.tool,
    summary: approval.summary,
    status: approval.status,
    // Full URL or search query when this is an outbound web request.
    // `summary` is capped at 300 characters and can hide a query string.
    display: card.display,
    url: card.url,
    host: card.host,
    query: card.query,
    offerAllowDomain: card.offerAllowDomain,
  }
}

export async function decideConnectorAction(
  approvalId: string,
  choice: "approve" | "decline",
  options?: { allowDomain?: boolean }
) {
  try {
    const answer = answerAction(approvalId, choice)
    if (choice === "approve" && options?.allowDomain) {
      const approval = getActionApproval(approvalId)
      const host = approval
        ? webApprovalCardFields({
            tool: approval.tool,
            args: approval.args,
            summary: approval.summary,
          }).host
        : null
      if (host) {
        const next = addAllowlistHost(getSetting("security.webAllowlist"), host)
        if (next) {
          setSetting("security.webAllowlist", next)
          revalidatePath("/", "layout")
        }
      }
    }
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
