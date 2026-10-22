// Whether a connector tool must wait for the person before it runs.
// Read tools run immediately. Sends, creates, updates and deletes wait,
// the same way a payment waits: the turn stops, nothing is sent, and the
// tool runs only when the same arguments are approved.

export type ApprovalMode = "writes" | "all" | "none"

const WRITE =
  /(?:^|_)(send|create|update|delete|remove|trash|reply|forward|insert|patch|write|modify|cancel|move|publish|post|draft|compose|edit|add|set|put|submit)(?:_|$)/i

export function toolNeedsApproval(
  name: string,
  options: {
    mode?: ApprovalMode
    approve?: string[]
    readOnly?: string[]
    readOnlyHint?: boolean
    destructiveHint?: boolean
  } = {}
) {
  if (options.approve?.includes(name)) return true
  if (options.readOnly?.includes(name)) return false
  if (options.mode === "all") return true
  if (options.mode === "none") return false
  if (options.readOnlyHint === true && options.destructiveHint !== true) return false
  if (options.destructiveHint === true) return true
  return WRITE.test(name)
}

// Stable JSON so {b,a} matches {a,b} when the agent calls the tool again.
export function canonicalArgs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalArgs).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalArgs(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function isApprovalHold(output: unknown) {
  return (
    !!output &&
    typeof output === "object" &&
    (output as { status?: unknown }).status === "needs-approval"
  )
}
