// Outbox for messages written while the app is offline. Safari has no
// Background Sync, so flushing is the caller's job (reconnect, visible, start).

export type OutboxState = "queued" | "sending" | "sent" | "failed"

export type OutboxEvent =
  | { type: "enqueue" }
  | { type: "start" }
  | { type: "ack" }
  | { type: "fail"; online: boolean }
  | { type: "retry" }

export function transition(state: OutboxState, event: OutboxEvent): OutboxState {
  switch (event.type) {
    case "enqueue":
      return "queued"
    case "start":
      if (state === "queued" || state === "failed") return "sending"
      return state
    case "ack":
      return state === "sending" ? "sent" : state
    case "fail":
      if (state !== "sending") return state
      // The connection dropped: keep it queued so the next flush sends it.
      // A failure while we were online stays failed until retry or reconnect.
      return event.online ? "failed" : "queued"
    case "retry":
      if (state === "failed" || state === "queued") return "queued"
      return state
    default:
      return state
  }
}

export function isFlushable(state: OutboxState) {
  return state === "queued" || state === "failed"
}

export type SendOutcome = { ok: true } | { ok: false; network: boolean; status?: number }

export type OutboxSnapshot = {
  id: string
  state: OutboxState
}

export function outboxError(outcome: Extract<SendOutcome, { ok: false }>) {
  if (outcome.network) return "Waiting for a connection."
  if (outcome.status === 401) return "Sign in again to send this."
  if (outcome.status) return `Couldn't send (${outcome.status}).`
  return "Couldn't send."
}

export async function flushOutbox<T extends OutboxSnapshot>(
  items: readonly T[],
  online: boolean,
  send: (item: T) => Promise<SendOutcome>,
  onUpdate?: (item: T, state: OutboxState, error?: string) => void
) {
  if (!online) return
  for (const item of items) {
    if (!isFlushable(item.state)) continue
    const sending = transition(item.state, { type: "start" })
    onUpdate?.(item, sending)
    let outcome: SendOutcome
    try {
      outcome = await send({ ...item, state: sending })
    } catch {
      outcome = { ok: false, network: true }
    }
    if (outcome.ok) {
      onUpdate?.(item, transition(sending, { type: "ack" }))
      continue
    }
    const next = transition(sending, { type: "fail", online: !outcome.network })
    onUpdate?.(item, next, outboxError(outcome))
  }
}
