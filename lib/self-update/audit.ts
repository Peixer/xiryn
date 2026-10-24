import { redact } from "@/lib/self-update/redact"
import type { Colour } from "@/lib/self-update/state"

export type AuditOp = "prepare" | "switch" | "rollback" | "status"

export type AuditEntry = {
  ts: string
  op: AuditOp
  result: "started" | "ok" | "refused" | "failed"
  actor: "owner" | "agent" | "helper"
  sha: string | null
  active: Colour | null
  candidate: Colour | null
  error: string | null
}

// One JSON object, one line. Paths, env files, and secrets are not fields.
export function formatAudit(entry: AuditEntry) {
  const body = {
    ts: entry.ts,
    op: entry.op,
    result: entry.result,
    actor: entry.actor,
    sha: entry.sha,
    active: entry.active,
    candidate: entry.candidate,
    error: entry.error ? redact(entry.error).slice(0, 500) : null,
  }
  return JSON.stringify(body)
}
