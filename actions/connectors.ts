"use server"

import { revalidatePath } from "next/cache"

import {
  addAllowlistHost,
  parseWebApprovalMode,
  webApprovalCardFields,
} from "@/lib/agent/untrusted"
import { getSetting, setSetting } from "@/lib/config"
import { answerAction, approvalCardText, getActionApproval } from "@/lib/mcp/approval"
import { parseMcpConfig, readMcpConfig, writeMcpConfig } from "@/lib/mcp/config"
import { driveAbout } from "@/lib/mcp/drive"
import { disconnectGoogle, googleAccessToken, googleConnected } from "@/lib/mcp/google"
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
  const card = webApprovalCardFields({
    tool: approval.tool,
    args: approval.args,
    summary: approval.summary,
    mode: parseWebApprovalMode(getSetting("security.webApproval")),
  })
  return {
    id: approval.id,
    tool: approval.tool,
    summary: approvalCardText(approval),
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
    if (
      choice === "approve" &&
      options?.allowDomain &&
      parseWebApprovalMode(getSetting("security.webApproval")) === "new-domains"
    ) {
      const row = getActionApproval(approvalId)
      const host = row
        ? webApprovalCardFields({
            tool: row.tool,
            args: row.args,
            summary: row.summary,
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
    const approval = getActionApproval(approvalId)
    const shown = approval ? approvalCardText(approval) : answer.marker.summary
    const { closeActionNotice } = await import("@/lib/telegram/bridge")
    await closeActionNotice(
      approvalId,
      choice === "approve" ? `Approved\n${shown}` : `Declined\n${shown}`
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

export async function testDriveConnection() {
  try {
    if (!googleConnected())
      return { ok: false as const, error: "Google is not connected." }
    const about = await driveAbout({ token: await googleAccessToken() })
    const who = about.email || about.displayName
    return {
      ok: true as const,
      detail: who ? `Connected as ${who}` : "Connected",
    }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}
