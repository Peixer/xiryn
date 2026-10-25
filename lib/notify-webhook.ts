import { eq } from "drizzle-orm"

import { db } from "@/db"
import { threads } from "@/db/schema"
import { getSetting } from "@/lib/config"
import { subscribe, type XirynEvent } from "@/lib/events"

// A phone notification when a task finishes or needs you, including on a
// headless machine. The URL is a secret: it is never written to the log.
// Nothing is sent until one is configured, and only Xiryn's own events go out.

export const NOTIFY_FORMATS = ["ntfy", "slack", "json"] as const
export type NotifyFormat = (typeof NOTIFY_FORMATS)[number]

export const NOTIFY_TRIGGERS = [
  "finished",
  "failed",
  "approval",
  "takeover",
  "secret",
] as const
export type NotifyTrigger = (typeof NOTIFY_TRIGGERS)[number]

export const PREVIEW_MAX = 140
export const NOTIFY_TIMEOUT_MS = 5_000
// One try, then a single retry. Not more.
export const NOTIFY_MAX_ATTEMPTS = 2

const DEFAULT_TRIGGERS = NOTIFY_TRIGGERS.join(",")

export type NotifyConfig = {
  url?: string
  format: NotifyFormat
  triggers: ReadonlySet<NotifyTrigger>
  preview: boolean
}

export type NotifyPayload = {
  headers: Record<string, string>
  body: string
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return (
      (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0
    )
  } catch {
    return false
  }
}

export function assertWebhookUrl(value: string) {
  if (!isHttpUrl(value)) {
    throw new Error("Notification webhook URL must be an http or https URL.")
  }
}

export function assertWebhookFormat(value: string) {
  if (!NOTIFY_FORMATS.includes(value.trim() as NotifyFormat)) {
    throw new Error("Notification format is ntfy, slack or json.")
  }
}

export function assertWebhookTriggers(value: string) {
  const trimmed = value.trim()
  if (trimmed === "none") return
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  const known = new Set<string>(NOTIFY_TRIGGERS)
  if (parts.length === 0 || parts.some((part) => !known.has(part))) {
    throw new Error(
      "Notification triggers are finished, failed, approval, takeover or secret."
    )
  }
}

export function assertWebhookPreview(value: string) {
  if (value.trim() !== "on" && value.trim() !== "off") {
    throw new Error("Notification previews are either on or off.")
  }
}

export function parseNotifyFormat(value: string | undefined): NotifyFormat {
  const trimmed = value?.trim()
  return trimmed === "ntfy" || trimmed === "slack" || trimmed === "json"
    ? trimmed
    : "json"
}

export function parseNotifyTriggers(value: string | undefined): NotifyTrigger[] {
  if (value === undefined) return [...NOTIFY_TRIGGERS]
  const trimmed = value.trim()
  if (!trimmed || trimmed === "none") return []
  const found: NotifyTrigger[] = []
  for (const part of trimmed.split(",")) {
    const token = part.trim()
    if (
      (NOTIFY_TRIGGERS as readonly string[]).includes(token) &&
      !found.includes(token as NotifyTrigger)
    ) {
      found.push(token as NotifyTrigger)
    }
  }
  return found
}

export function notifyConfigFrom(values: {
  url?: string
  format?: string
  triggers?: string
  preview?: string
}): NotifyConfig {
  const url = values.url?.trim()
  return {
    url: url || undefined,
    format: parseNotifyFormat(values.format),
    triggers: new Set(parseNotifyTriggers(values.triggers ?? DEFAULT_TRIGGERS)),
    preview: values.preview === "on",
  }
}

export function loadNotifyConfig(): NotifyConfig {
  return notifyConfigFrom({
    url: getSetting("notify.webhookUrl"),
    format: getSetting("notify.webhookFormat"),
    triggers: getSetting("notify.webhookTriggers"),
    preview: getSetting("notify.webhookPreview"),
  })
}

export function triggerForEvent(event: XirynEvent): NotifyTrigger | null {
  switch (event.type) {
    case "turn-started":
      return null
    case "turn-finished":
      return event.ok ? "finished" : "failed"
    case "payment":
    case "action":
      return "approval"
    case "takeover":
      return "takeover"
    case "secret":
      return "secret"
  }
}

export function clipPreview(text: string, max = PREVIEW_MAX) {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}

function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function headline(name: string, trigger: NotifyTrigger, title: string) {
  switch (trigger) {
    case "finished":
      return `${name} finished: ${title}`
    case "failed":
      return `${name} failed: ${title}`
    case "approval":
      return `${name} needs approval: ${title}`
    case "takeover":
      return `${name} needs takeover: ${title}`
    case "secret":
      return `${name} needs a secret: ${title}`
  }
}

function previewSource(event: XirynEvent) {
  switch (event.type) {
    case "turn-started":
      return ""
    case "turn-finished":
      return event.preview.trim() ? event.preview : (event.error ?? "")
    default:
      return event.reason
  }
}

export function mapNotifyPayload(input: {
  event: XirynEvent
  format: NotifyFormat
  title: string
  includePreview: boolean
}): NotifyPayload | null {
  const trigger = triggerForEvent(input.event)
  if (!trigger) return null
  const title = oneLine(input.title) || "Untitled"
  const message = headline(oneLine(input.event.name) || "Agent", trigger, title)
  const preview = input.includePreview ? clipPreview(previewSource(input.event)) : ""
  const text = preview ? `${message}\n${preview}` : message

  if (input.format === "ntfy") {
    return {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // ASCII only. A name in the header can be rejected by fetch.
        Title: "Xiryn",
        Priority: trigger === "finished" ? "default" : "high",
      },
      body: text,
    }
  }

  if (input.format === "slack") {
    return {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text }),
    }
  }

  const payload: Record<string, unknown> = {
    message,
    trigger,
    type: input.event.type,
    agent: input.event.name,
    title,
    threadId: input.event.threadId,
    href: input.event.href,
    via: input.event.via,
  }
  if (input.event.type === "turn-finished") payload.ok = input.event.ok
  if (preview) payload.preview = preview
  return {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  }
}

function threadTitle(threadId: string) {
  try {
    const row = db
      .select({ title: threads.title })
      .from(threads)
      .where(eq(threads.id, threadId))
      .get()
    return row?.title?.trim() || "Untitled"
  } catch {
    return "Untitled"
  }
}

function redact(message: string, secretUrl?: string) {
  let next = message
  if (secretUrl) {
    next = next.split(secretUrl).join("[redacted]")
    try {
      const parsed = new URL(secretUrl)
      if (parsed.password)
        next = next.split(decodeURIComponent(parsed.password)).join("[redacted]")
      if (parsed.username)
        next = next.split(decodeURIComponent(parsed.username)).join("[redacted]")
      if (parsed.host) next = next.split(parsed.host).join("[redacted]")
      if (parsed.pathname && parsed.pathname !== "/") {
        next = next.split(parsed.pathname).join("[redacted]")
      }
    } catch {
      // The value was not a URL. The raw string was already removed above.
    }
  }
  return next.replace(/https?:\/\/\S+/gi, "[redacted]")
}

function describeFailure(error: unknown) {
  const parts: string[] = []
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return
    if (typeof value === "string") {
      parts.push(value)
      return
    }
    if (value instanceof Error) {
      if (value.message) parts.push(value.message)
      const code = (value as NodeJS.ErrnoException).code
      if (typeof code === "string") parts.push(code)
      walk((value as { cause?: unknown }).cause, depth + 1)
    }
  }
  walk(error, 0)
  return parts.filter(Boolean).join(": ") || "request failed"
}

function logFailure(error: unknown, secretUrl?: string) {
  // The string only. Never the error object, and never the URL.
  console.error(
    "[xiryn] notify webhook failed:",
    redact(describeFailure(error), secretUrl)
  )
}

function retryableStatus(status: number) {
  return status === 429 || status >= 500
}

export type NotifyDeps = {
  config?: NotifyConfig
  title?: string
  fetchImpl?: typeof fetch
}

export async function deliverNotifyWebhook(event: XirynEvent, deps: NotifyDeps = {}) {
  let secretUrl: string | undefined
  try {
    const config = deps.config ?? loadNotifyConfig()
    if (!config.url) return
    secretUrl = config.url
    if (!isHttpUrl(config.url)) {
      logFailure(new Error("webhook URL is not http(s)"), config.url)
      return
    }
    const trigger = triggerForEvent(event)
    if (!trigger || !config.triggers.has(trigger)) return
    const title = (deps.title ?? threadTitle(event.threadId)).trim() || "Untitled"
    const mapped = mapNotifyPayload({
      event,
      format: config.format,
      title,
      includePreview: config.preview,
    })
    if (!mapped) return
    const fetchImpl = deps.fetchImpl ?? fetch
    let last: unknown
    for (let attempt = 0; attempt < NOTIFY_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetchImpl(config.url, {
          method: "POST",
          headers: mapped.headers,
          body: mapped.body,
          signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
          redirect: "error",
        })
        await response.body?.cancel().catch(() => {})
        if (response.ok) return
        last = new Error(`HTTP ${response.status}`)
        if (!retryableStatus(response.status)) break
      } catch (error) {
        last = error
      }
    }
    logFailure(last, config.url)
  } catch (error) {
    logFailure(error, secretUrl)
  }
}

const globalForNotify = globalThis as unknown as {
  __xirynNotifyWebhook?: { unsubscribe: () => void }
}

export function startNotifyWebhook() {
  globalForNotify.__xirynNotifyWebhook?.unsubscribe()
  const unsubscribe = subscribe(
    (event) => {
      void deliverNotifyWebhook(event)
    },
    { background: true }
  )
  globalForNotify.__xirynNotifyWebhook = { unsubscribe }
}

export function stopNotifyWebhook() {
  globalForNotify.__xirynNotifyWebhook?.unsubscribe()
  globalForNotify.__xirynNotifyWebhook = undefined
}
