import type { XirynEvent } from "@/lib/events"
import { redactText } from "@/lib/pwa/sanitize"

export type PushNotice = {
  title: string
  body: string
  href: string
  tag: string
}

function clip(text: string) {
  const clean = redactText(text.replace(/\s+/g, " ").trim())
  if (clean.length <= 140) return clean
  return `${clean.slice(0, 139)}…`
}

function safeHref(href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return "/"
  const path = href.split("?")[0]?.split("#")[0] ?? "/"
  const lower = path.toLowerCase()
  if (
    lower.includes("vault") ||
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.startsWith("/api/") ||
    lower.startsWith("/settings")
  ) {
    return "/"
  }
  return path
}

// A short notice for the installed app. No tool output, no approval token.
export function pushNotice(event: XirynEvent): PushNotice | null {
  if (event.type === "turn-started") return null
  const href = safeHref(event.href)
  const tag = event.threadId.slice(0, 64)
  if (event.type !== "turn-finished") {
    const status =
      event.type === "payment"
        ? "wants to pay"
        : event.type === "secret"
          ? "needs a detail"
          : event.type === "action"
            ? "wants approval"
            : "needs you"
    return {
      title: `${event.name} ${status}`,
      body: clip(event.reason),
      href,
      tag,
    }
  }
  return {
    title: event.ok ? `${event.name} finished` : `${event.name} stopped`,
    body: clip(event.ok ? event.preview : (event.error ?? "Something went wrong.")),
    href,
    tag,
  }
}
