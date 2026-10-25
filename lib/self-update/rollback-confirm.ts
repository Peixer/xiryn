import { SELF_UPDATE_TOOL } from "@/lib/self-update/approval-gate"

const CONFIRM_DISCARD = "Confirm that data written since the switch will be discarded."

export function assertRollbackConfirmation(
  op: string,
  confirmDiscard: boolean | undefined
) {
  if (op === "rollback" && confirmDiscard !== true) return CONFIRM_DISCARD
  return null
}

export function isRollbackRequest(tool: string, args: unknown) {
  if (tool !== SELF_UPDATE_TOOL) return false
  let parsed = args
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args)
    } catch {
      return false
    }
  }
  return (
    !!parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as { op?: unknown }).op === "rollback"
  )
}

export function rollbackCallbackDecision(input: {
  isRollback: boolean
  verb: "yes" | "no" | "discard"
}): { ok: true; choice: "approve" | "decline" } | { ok: false; error: string } {
  if (input.verb === "discard" && !input.isRollback) {
    return { ok: false, error: "That confirmation is only for a rollback." }
  }
  if (input.verb === "yes" && input.isRollback) {
    return { ok: false, error: CONFIRM_DISCARD }
  }
  return { ok: true, choice: input.verb === "no" ? "decline" : "approve" }
}
