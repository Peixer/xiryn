"use server"

import { revalidatePath } from "next/cache"

import { getSetting } from "@/lib/config"
import { answerAction, getActionApproval } from "@/lib/mcp/approval"
import { parseMcpConfig, readMcpConfig, writeMcpConfig } from "@/lib/mcp/config"
import { disconnectGoogle } from "@/lib/mcp/google"
import { resetMcpClients } from "@/lib/mcp/load"
import {
  authorizeStdioSave,
  issueStdioConfirmation,
  reviewStdioSave,
} from "@/lib/mcp/stdio-confirm"

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function mcpBody(text: string) {
  return text.trim() ? text : '{"servers":[]}\n'
}

function reviewed(text: string) {
  const next = parseMcpConfig(mcpBody(text)).servers
  return reviewStdioSave({
    previous: readMcpConfig().servers,
    next,
    allowedExtension: getSetting("mcp.allowedCommands"),
  })
}

export async function issueMcpStdioConfirmation(text: string) {
  try {
    const review = reviewed(text)
    if (!review.ok) return review
    if (review.confirm.length === 0) {
      return { ok: false as const, error: "No stdio command change to confirm." }
    }
    return { ok: true as const, token: issueStdioConfirmation(review.confirm) }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

export async function saveMcpConfig(text: string, confirmationToken?: string) {
  try {
    const body = mcpBody(text)
    const next = parseMcpConfig(body).servers
    const decision = authorizeStdioSave({
      previous: readMcpConfig().servers,
      next,
      allowedExtension: getSetting("mcp.allowedCommands"),
      token: confirmationToken,
    })
    if (!decision.ok) return decision
    writeMcpConfig(body)
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
