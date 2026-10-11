import {
  addVaultItem,
  decideApproval,
  getApproval,
  getVaultItem,
  type VaultKind,
} from "@/lib/vault"

// Answers to an agent's payment approval or secret request. The app and the
// Telegram bridge both use these, and both then continue the thread with the
// returned text, which carries hints and ids only, never values.

export type VaultMarker = {
  action: "approved" | "declined" | "taken-over" | "provided"
  summary: string
}

export type PaymentChoice = { itemId: string } | "takeover" | "decline"

export function answerPayment(approvalId: string, choice: PaymentChoice) {
  const pending = getApproval(approvalId)
  if (!pending) throw new Error("That payment request no longer exists.")

  if (choice === "decline") {
    decideApproval(approvalId, "declined")
    return {
      text: `I've declined the payment of ${pending.amount} to ${pending.merchant}. Don't pay. Tell me what you'd suggest instead.`,
      marker: {
        action: "declined",
        summary: `${pending.amount} to ${pending.merchant}`,
      } satisfies VaultMarker,
    }
  }

  if (choice === "takeover") {
    decideApproval(approvalId, "taken-over")
    return {
      text: null,
      marker: {
        action: "taken-over",
        summary: `${pending.amount} to ${pending.merchant}`,
      } satisfies VaultMarker,
    }
  }

  decideApproval(approvalId, "approved", choice.itemId)
  const item = getVaultItem(choice.itemId)!
  return {
    text: `Approved: pay ${pending.amount} to ${pending.merchant} with ${item.hint} (vault item ${item.id}). Fill the payment details with vault_fill and complete the payment, then tell me how it went.`,
    marker: {
      action: "approved",
      summary: `${pending.amount} to ${pending.merchant} · ${item.hint}`,
    } satisfies VaultMarker,
  }
}

export function answerSecret(
  kind: VaultKind,
  data: unknown,
  options: { save: boolean; label?: string }
) {
  // A code is only ever good once
  const save = kind !== "code" && options.save
  const item = addVaultItem(kind, data, { label: options.label, ephemeral: !save })
  return {
    item,
    text:
      kind === "code"
        ? `I've put the code in the vault as item ${item.id}. Fill it with vault_fill (field "code").`
        : `I've added ${item.hint} to the vault as item ${item.id}${save ? ", saved for next time" : ", for this task only"}. Use it with vault_fill.`,
    marker: {
      action: "provided",
      summary: kind === "code" ? "one-time code" : item.hint,
    } satisfies VaultMarker,
  }
}
