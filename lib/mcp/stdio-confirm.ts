import { randomBytes } from "node:crypto"

import {
  mcpCommandRefusal,
  stdioLaunchesNeedingConfirmation,
  type McpServerShape,
  type StdioLaunch,
} from "@/lib/mcp/stdio-policy"

export const STDIO_CONFIRM_TTL_MS = 10 * 60 * 1000

const CONFIRM_ERROR =
  "Confirm this stdio command before saving. It runs on the host, as the user who runs Xiryn."

type Pending = { key: string; expiresAt: number }

const globalForConfirm = globalThis as typeof globalThis & {
  __xirynStdioConfirm?: Map<string, Pending>
}

function pending() {
  return (globalForConfirm.__xirynStdioConfirm ??= new Map())
}

export function resetStdioConfirmations() {
  pending().clear()
}

function canonical(launches: StdioLaunch[]) {
  const rows = launches.map((launch) => ({
    id: launch.id,
    command: launch.command,
    args: [...launch.args],
  }))
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify(rows)
}

function sweep(now: number) {
  for (const [token, row] of pending()) {
    if (row.expiresAt <= now) pending().delete(token)
  }
}

export function issueStdioConfirmation(launches: StdioLaunch[], now = Date.now()) {
  if (launches.length === 0) throw new Error("No stdio command to confirm.")
  sweep(now)
  const token = randomBytes(32).toString("base64url")
  pending().set(token, {
    key: canonical(launches),
    expiresAt: now + STDIO_CONFIRM_TTL_MS,
  })
  return token
}

export function consumeStdioConfirmation(
  token: string,
  launches: StdioLaunch[],
  now = Date.now()
) {
  const row = pending().get(token)
  if (!row) return false
  pending().delete(token)
  if (now >= row.expiresAt) return false
  return row.key === canonical(launches)
}

export function reviewStdioSave(input: {
  previous: McpServerShape[]
  next: McpServerShape[]
  allowedExtension?: string
}): { ok: true; confirm: StdioLaunch[] } | { ok: false; error: string } {
  for (const server of input.next) {
    if (server.transport !== "stdio") continue
    const refusal = mcpCommandRefusal(
      server.command ?? "",
      server.args ?? [],
      input.allowedExtension
    )
    if (refusal) return { ok: false, error: `${server.id}: ${refusal}` }
  }
  return {
    ok: true,
    confirm: stdioLaunchesNeedingConfirmation(input.previous, input.next),
  }
}

export function authorizeStdioSave(input: {
  previous: McpServerShape[]
  next: McpServerShape[]
  allowedExtension?: string
  token?: string
  now?: number
}): { ok: true } | { ok: false; error: string; confirm?: StdioLaunch[] } {
  const review = reviewStdioSave(input)
  if (!review.ok) return review
  if (review.confirm.length === 0) return { ok: true }
  const token = input.token?.trim()
  if (!token || !consumeStdioConfirmation(token, review.confirm, input.now)) {
    return { ok: false, error: CONFIRM_ERROR, confirm: review.confirm }
  }
  return { ok: true }
}
