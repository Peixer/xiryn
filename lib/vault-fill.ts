import { sameSite } from "@/lib/etld"

// Whether vault_fill may type a login. Cards and UPI IDs are unchanged:
// they still go through request_payment_approval. There is no per-item
// "allow without asking"; each login fill asks, and the approval is consumed
// when that exact call runs.

export type LoginFillStep =
  | { action: "continue" }
  | { action: "refuse"; message: string }
  | { action: "ask"; summary: string; host: string }
  | { action: "fill"; host: string }

export function assessLoginFill(input: {
  kind: string
  label: string
  site: string | null
  field: string
  pageHost: string | null
  approved: boolean
}): LoginFillStep {
  if (input.kind !== "login") return { action: "continue" }
  const host = input.pageHost
  if (!host || !sameSite(host, input.site)) {
    const where = host ?? "not a confirmed website"
    const saved = input.site ?? "an unknown site"
    return {
      action: "refuse",
      message: `"${input.label}" is a login for ${saved}, but the focused page is ${where}. Logins only fill when that page's site matches the saved one.`,
    }
  }
  if (!input.approved) {
    const field = input.field.replace(/_/g, " ")
    return {
      action: "ask",
      host,
      // Host first. The stored summary is cut at 300 characters, and a
      // hostname can be 253 of those; the registrable domain sits at the end.
      summary: `On ${host}, fill the ${field} for “${input.label}”`,
    }
  }
  return { action: "fill", host }
}

// Bound to the call the person approved. The secret is not an argument.
export function loginApprovalArgs(input: {
  id: string
  field: string
  host: string
  x?: number
  y?: number
}) {
  const args: { id: string; field: string; host: string; x?: number; y?: number } = {
    id: input.id,
    field: input.field,
    host: input.host,
  }
  if (input.x !== undefined && input.y !== undefined) {
    args.x = input.x
    args.y = input.y
  }
  return args
}

// What the tool returns after a fill. Callers pass the hint, never the value.
export function vaultFillOutput(field: string, hint: string, host: string | null) {
  return {
    filled: field.replace(/_/g, " "),
    item: hint,
    site: host,
  }
}

// What the model is allowed to see. Extra keys, including a value, are dropped.
export function vaultFillForModel(output: {
  status?: unknown
  approvalId?: unknown
  summary?: unknown
  filled?: unknown
  item?: unknown
  site?: unknown
  [key: string]: unknown
}) {
  if (output.status === "needs-approval") {
    return {
      type: "text" as const,
      value: JSON.stringify({
        status: "needs-approval",
        approvalId: typeof output.approvalId === "string" ? output.approvalId : "",
        summary: typeof output.summary === "string" ? output.summary : "",
      }),
    }
  }
  return {
    type: "text" as const,
    value: JSON.stringify({
      filled: typeof output.filled === "string" ? output.filled : "",
      item: typeof output.item === "string" ? output.item : "",
      site: typeof output.site === "string" ? output.site : null,
    }),
  }
}
