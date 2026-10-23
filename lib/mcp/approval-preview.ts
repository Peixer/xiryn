import { createHash } from "node:crypto"

import { canonicalArgs } from "@/lib/mcp/policy"

// How much of a long body or argument blob the card and Telegram message
// show. The rest stays in the hashed arguments and is counted in the marker.
export const APPROVAL_BODY_LIMIT = 2_000
const FIELD_LIMIT = 300
const CARD_LIMIT = 3_000

const SECRET_KEY =
  /token|password|passwd|secret|credential|(^|[_\-.])(api[_\-.]?)?keys?$/i

export function isSecretKey(name: string) {
  return SECRET_KEY.test(name)
}

// SHA-256 of the canonical arguments. Approval runs only when a later call
// hashes to the same value, so the payload cannot change after it is shown.
export function approvalArgsHash(args: unknown) {
  return createHash("sha256").update(canonicalArgs(args)).digest("hex")
}

export function approvalHeadline(text: string) {
  const line = text.split("\n").find((item) => item.trim()) ?? text
  if (line.length <= 180) return line
  const omitted = line.length - 180
  return `${line.slice(0, 180)}… truncated, ${omitted} more chars`
}

function clip(text: string, limit: number) {
  if (text.length <= limit) return text
  const omitted = text.length - limit
  return `${text.slice(0, limit)}\n… truncated, ${omitted} more chars`
}

function shown(text: string, limit: number) {
  return clip(text.length ? text : "(none)", limit)
}

function stringOf(value: unknown) {
  return typeof value === "string" ? value : ""
}

function capCard(text: string) {
  return clip(text, CARD_LIMIT)
}

export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item))
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? "••••" : maskSecrets(item)
  }
  return out
}

export function attendeeEmails(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : []
    if (item && typeof item === "object" && "email" in item) {
      const email = stringOf((item as { email?: unknown }).email).trim()
      return email ? [email] : []
    }
    return []
  })
}

type When = { dateTime?: string; date?: string; timeZone?: string }

export function normalizeWhen(value: unknown): When | undefined {
  if (!value || typeof value !== "object") return undefined
  const when = value as When
  if (typeof when.date === "string" && when.date && !when.dateTime)
    return { date: when.date }
  if (typeof when.dateTime !== "string" || !when.dateTime) return undefined
  return when.timeZone
    ? { dateTime: when.dateTime, timeZone: when.timeZone }
    : { dateTime: when.dateTime }
}

function timeOf(value: unknown) {
  const when = typeof value === "string" ? { dateTime: value } : normalizeWhen(value)
  if (!when) return ""
  const clock = when.dateTime || when.date || ""
  return when.timeZone ? `${clock} ${when.timeZone}` : clock
}

export function mailApprovalArgs(input: {
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
}) {
  return {
    to: input.to,
    cc: input.cc ?? "",
    bcc: input.bcc ?? "",
    subject: input.subject,
    body: input.body,
  }
}

export function replyApprovalArgs(
  original: {
    id?: string
    threadId?: string
    from?: string
    subject?: string
    messageId?: string
  },
  body: string
) {
  const subject = original.subject ?? ""
  return {
    id: original.id ?? "",
    threadId: original.threadId ?? "",
    inReplyTo: original.messageId ?? "",
    to: original.from ?? "",
    cc: "",
    bcc: "",
    subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
    body,
  }
}

type EventInput = {
  id?: string
  summary?: string
  description?: string
  location?: string
  start?: When
  end?: When
  attendees?: string[]
}

type EventCurrent = {
  summary?: string
  description?: string
  location?: string
  start?: When
  end?: When
  attendees?: { email?: string }[]
}

// The arguments that are hashed and shown. For a delete, the fetched event
// wins over anything the model claims. For an update, the model's fields
// win, and everything else stays what is on the calendar now.
export function eventApprovalArgs(
  input: EventInput,
  current?: EventCurrent | null,
  options?: { preferCurrent?: boolean }
) {
  const preferCurrent = options?.preferCurrent === true
  const summary = preferCurrent
    ? (current?.summary ?? input.summary ?? "")
    : (input.summary ?? current?.summary ?? "")
  const description = preferCurrent
    ? (current?.description ?? input.description ?? "")
    : (input.description ?? current?.description ?? "")
  const location = preferCurrent
    ? (current?.location ?? input.location ?? "")
    : (input.location ?? current?.location ?? "")
  const start = preferCurrent
    ? (normalizeWhen(current?.start) ?? normalizeWhen(input.start))
    : (normalizeWhen(input.start) ?? normalizeWhen(current?.start))
  const end = preferCurrent
    ? (normalizeWhen(current?.end) ?? normalizeWhen(input.end))
    : (normalizeWhen(input.end) ?? normalizeWhen(current?.end))
  const attendees = preferCurrent
    ? attendeeEmails(current?.attendees ?? input.attendees)
    : input.attendees
      ? attendeeEmails(input.attendees)
      : attendeeEmails(current?.attendees)
  return {
    ...(input.id ? { id: input.id } : {}),
    summary,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    attendees,
  }
}

// Google Calendar body derived only from the approved arguments.
export function calendarWriteBody(
  args: Record<string, unknown>,
  writeAttendees: boolean
) {
  const body: Record<string, unknown> = {}
  if (typeof args.summary === "string" && args.summary) body.summary = args.summary
  if (typeof args.description === "string" && args.description)
    body.description = args.description
  if (typeof args.location === "string" && args.location) body.location = args.location
  if (args.start) body.start = args.start
  if (args.end) body.end = args.end
  if (writeAttendees) {
    body.attendees = attendeeEmails(args.attendees).map((email) => ({ email }))
  }
  return body
}

function gmailPreview(args: Record<string, unknown>) {
  return capCard(
    [
      `To: ${shown(stringOf(args.to), FIELD_LIMIT)}`,
      `Cc: ${shown(stringOf(args.cc), FIELD_LIMIT)}`,
      `Bcc: ${shown(stringOf(args.bcc), FIELD_LIMIT)}`,
      `Subject: ${shown(stringOf(args.subject), FIELD_LIMIT)}`,
      "Body:",
      shown(stringOf(args.body), APPROVAL_BODY_LIMIT),
    ].join("\n")
  )
}

function calendarPreview(args: Record<string, unknown>) {
  const start = timeOf(args.start)
  const end = timeOf(args.end)
  const when = start && end ? `${start} – ${end}` : start || end
  const attendees = attendeeEmails(args.attendees)
  const lines = [
    `Title: ${shown(stringOf(args.summary), FIELD_LIMIT)}`,
    `When: ${shown(when, FIELD_LIMIT)}`,
    `Attendees: ${shown(attendees.join(", "), FIELD_LIMIT)}`,
  ]
  if (stringOf(args.location))
    lines.push(`Location: ${shown(stringOf(args.location), FIELD_LIMIT)}`)
  if (stringOf(args.description)) {
    lines.push("Description:", shown(stringOf(args.description), APPROVAL_BODY_LIMIT))
  }
  if (stringOf(args.id)) lines.push(`Event: ${shown(stringOf(args.id), FIELD_LIMIT)}`)
  return capCard(lines.join("\n"))
}

function mcpPreview(tool: string, args: unknown) {
  const json = JSON.stringify(maskSecrets(args), null, 2) ?? "null"
  return capCard(`Tool: ${tool}\nArguments:\n${clip(json, APPROVAL_BODY_LIMIT)}`)
}

// Text shown on the approval card and in the Telegram approval message.
// It is a pure function of the arguments that were hashed.
export function renderApprovalPreview(tool: string, args: unknown) {
  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {}
  if (tool === "gmail_send" || tool === "gmail_draft" || tool === "gmail_reply") {
    return gmailPreview(record)
  }
  if (
    tool === "calendar_create_event" ||
    tool === "calendar_update_event" ||
    tool === "calendar_delete_event"
  ) {
    return calendarPreview(record)
  }
  return mcpPreview(tool, args)
}
