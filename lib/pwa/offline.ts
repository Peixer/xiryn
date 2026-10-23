// When to treat the app as offline, and when a queued message may leave.
// Background Sync is never a reason: Safari does not implement it.

export type FlushReason = "start" | "online" | "visible" | "background-sync"

export type Presence = "online" | "offline"

export function presence(navigatorOnLine: boolean | undefined): Presence {
  if (navigatorOnLine === false) return "offline"
  return "online"
}

export function shouldFlushOutbox(input: { reason: FlushReason; online: boolean }) {
  if (!input.online) return false
  if (input.reason === "background-sync") return false
  return (
    input.reason === "start" || input.reason === "online" || input.reason === "visible"
  )
}

export function isNetworkFailure(error: unknown, online: boolean) {
  if (!online) return true
  if (typeof error !== "object" || error === null) return false
  const name = "name" in error ? String(error.name) : ""
  if (name === "TypeError") return true
  const message = "message" in error ? String(error.message).toLowerCase() : ""
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("offline")
  )
}
