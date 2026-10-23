import { tool } from "ai"
import { z } from "zod"

import { toUntrustedModelOutput } from "@/lib/agent/untrusted"
import type { ToolEnv } from "@/lib/agent/tools"
import { connectorEnabled, googleFetch } from "@/lib/mcp/google"
import { holdOrRun } from "@/lib/mcp/guard"

const CLIP = 8_000

function clip(text: string) {
  if (text.length <= CLIP) return text
  return `${text.slice(0, CLIP)}\n… truncated`
}

function header(headers: { name?: string; value?: string }[] | undefined, name: string) {
  return headers?.find((item) => item.name?.toLowerCase() === name)?.value ?? ""
}

function plainPart(part: {
  mimeType?: string
  body?: { data?: string }
  parts?: unknown[]
}): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8")
  }
  if (Array.isArray(part.parts)) {
    return part.parts.map((child) => plainPart(child as typeof part)).join("\n")
  }
  return ""
}

type GmailMessage = {
  id?: string
  threadId?: string
  snippet?: string
  payload?: {
    headers?: { name?: string; value?: string }[]
    mimeType?: string
    body?: { data?: string }
    parts?: unknown[]
  }
}

function describeMessage(message: GmailMessage) {
  const headers = message.payload?.headers
  const body = message.payload ? plainPart(message.payload) : ""
  return {
    id: message.id,
    threadId: message.threadId,
    from: header(headers, "from"),
    to: header(headers, "to"),
    subject: header(headers, "subject"),
    date: header(headers, "date"),
    messageId: header(headers, "message-id"),
    snippet: message.snippet,
    body: clip(body || message.snippet || ""),
  }
}

function rawMessage(headers: Record<string, string>, body: string) {
  const lines = Object.entries(headers).map(
    ([name, value]) => `${name}: ${value.replace(/[\r\n]+/g, " ")}`
  )
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n${body}`).toString("base64url")
}

async function gmailGet(id: string) {
  return googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`
  ) as Promise<GmailMessage>
}

export function createGoogleTools(env: ToolEnv) {
  const tools: Record<string, unknown> = {}

  if (connectorEnabled("gmail")) {
    tools.gmail_search = tool({
      description:
        "Search the person's Gmail. Uses Gmail search syntax (from:, subject:, newer_than:). Returns ids, subjects and snippets, not full bodies.",
      inputSchema: z.object({
        query: z.string().describe("Gmail search query. Empty lists recent mail."),
        limit: z.number().int().min(1).max(15).optional(),
      }),
      execute: async ({ query, limit = 8 }) => {
        const listed = (await googleFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=${encodeURIComponent(query)}`
        )) as { messages?: { id: string }[] } | null
        const messages = await Promise.all(
          (listed?.messages ?? []).map((item) => gmailGet(item.id))
        )
        return {
          messages: messages.map((message) => {
            const view = describeMessage(message)
            return { ...view, body: undefined, snippet: view.snippet }
          }),
        }
      },
      toModelOutput: ({ output }) => toUntrustedModelOutput("gmail_search", output),
    })

    tools.gmail_read = tool({
      description: "Read one Gmail message by id, including its plain-text body.",
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => describeMessage(await gmailGet(id)),
      toModelOutput: ({ output }) => toUntrustedModelOutput("gmail_read", output),
    })

    tools.gmail_draft = tool({
      description:
        "Save a Gmail draft. Does not send. Waits for approval before writing the draft.",
      inputSchema: z.object({
        to: z.string().min(3),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20_000),
        cc: z.string().optional(),
      }),
      execute: async (input) => {
        const hold = await holdOrRun(env, {
          tool: "gmail_draft",
          summary: `Draft to ${input.to}: ${input.subject}`,
          args: input,
        })
        if (hold) return hold
        const raw = rawMessage(
          {
            To: input.to,
            Subject: input.subject,
            ...(input.cc ? { Cc: input.cc } : {}),
            "Content-Type": "text/plain; charset=utf-8",
          },
          input.body
        )
        const draft = (await googleFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
          { method: "POST", body: JSON.stringify({ message: { raw } }) }
        )) as { id?: string }
        return { drafted: true, draftId: draft.id }
      },
    })

    tools.gmail_send = tool({
      description:
        "Send an email from the person's Gmail. Waits for their approval and sends only the exact message they approved.",
      inputSchema: z.object({
        to: z.string().min(3),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20_000),
        cc: z.string().optional(),
      }),
      execute: async (input) => {
        const hold = await holdOrRun(env, {
          tool: "gmail_send",
          summary: `Send to ${input.to}: ${input.subject}`,
          args: input,
        })
        if (hold) return hold
        const raw = rawMessage(
          {
            To: input.to,
            Subject: input.subject,
            ...(input.cc ? { Cc: input.cc } : {}),
            "Content-Type": "text/plain; charset=utf-8",
          },
          input.body
        )
        const sent = (await googleFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          { method: "POST", body: JSON.stringify({ raw }) }
        )) as { id?: string; threadId?: string }
        return { sent: true, id: sent.id, threadId: sent.threadId }
      },
    })

    tools.gmail_reply = tool({
      description:
        "Reply to a Gmail message by id. Waits for approval, then sends the reply on that thread.",
      inputSchema: z.object({
        id: z.string().min(1).describe("The message id to reply to"),
        body: z.string().min(1).max(20_000),
      }),
      execute: async (input) => {
        const original = describeMessage(await gmailGet(input.id))
        const hold = await holdOrRun(env, {
          tool: "gmail_reply",
          summary: `Reply to ${original.from || original.id}: ${original.subject}`,
          args: input,
        })
        if (hold) return hold
        const subject = original.subject?.toLowerCase().startsWith("re:")
          ? original.subject
          : `Re: ${original.subject || ""}`
        const raw = rawMessage(
          {
            To: original.from,
            Subject: subject,
            ...(original.messageId
              ? { "In-Reply-To": original.messageId, References: original.messageId }
              : {}),
            "Content-Type": "text/plain; charset=utf-8",
          },
          input.body
        )
        const sent = (await googleFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            body: JSON.stringify({ raw, threadId: original.threadId }),
          }
        )) as { id?: string }
        return { sent: true, id: sent.id }
      },
    })
  }

  if (connectorEnabled("calendar")) {
    const when = z.object({
      dateTime: z
        .string()
        .describe("ISO-8601 local or offset time, e.g. 2026-10-23T09:00:00"),
      timeZone: z.string().describe("IANA time zone, e.g. Europe/Paris"),
    })

    tools.calendar_list_events = tool({
      description:
        "List events on the person's primary Google Calendar between two times.",
      inputSchema: z.object({
        timeMin: z.string().describe("ISO-8601 start, inclusive"),
        timeMax: z.string().describe("ISO-8601 end, exclusive"),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ timeMin, timeMax, limit = 15 }) => {
        const url = new URL(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        )
        url.searchParams.set("timeMin", timeMin)
        url.searchParams.set("timeMax", timeMax)
        url.searchParams.set("singleEvents", "true")
        url.searchParams.set("orderBy", "startTime")
        url.searchParams.set("maxResults", String(limit))
        const json = (await googleFetch(url.toString())) as {
          items?: {
            id?: string
            summary?: string
            location?: string
            htmlLink?: string
            start?: { dateTime?: string; date?: string }
            end?: { dateTime?: string; date?: string }
          }[]
        } | null
        return {
          events: (json?.items ?? []).map((event) => ({
            id: event.id,
            summary: event.summary,
            location: event.location,
            start: event.start?.dateTime || event.start?.date,
            end: event.end?.dateTime || event.end?.date,
            link: event.htmlLink,
          })),
        }
      },
    })

    tools.calendar_create_event = tool({
      description:
        "Create an event on the primary calendar. Waits for approval before creating it.",
      inputSchema: z.object({
        summary: z.string().min(1).max(200),
        description: z.string().max(4_000).optional(),
        location: z.string().max(300).optional(),
        start: when,
        end: when,
      }),
      execute: async (input) => {
        const hold = await holdOrRun(env, {
          tool: "calendar_create_event",
          summary: `Create “${input.summary}” ${input.start.dateTime}`,
          args: input,
        })
        if (hold) return hold
        const created = (await googleFetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          { method: "POST", body: JSON.stringify(input) }
        )) as { id?: string; htmlLink?: string }
        return { created: true, id: created.id, link: created.htmlLink }
      },
    })

    tools.calendar_update_event = tool({
      description: "Change an existing calendar event. Waits for approval.",
      inputSchema: z.object({
        id: z.string().min(1),
        summary: z.string().min(1).max(200).optional(),
        description: z.string().max(4_000).optional(),
        location: z.string().max(300).optional(),
        start: when.optional(),
        end: when.optional(),
      }),
      execute: async (input) => {
        const hold = await holdOrRun(env, {
          tool: "calendar_update_event",
          summary: `Update event ${input.id}${input.summary ? `: ${input.summary}` : ""}`,
          args: input,
        })
        if (hold) return hold
        const { id, ...patch } = input
        const updated = (await googleFetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
          { method: "PATCH", body: JSON.stringify(patch) }
        )) as { id?: string; htmlLink?: string }
        return { updated: true, id: updated.id, link: updated.htmlLink }
      },
    })

    tools.calendar_delete_event = tool({
      description: "Delete a calendar event. Waits for approval.",
      inputSchema: z.object({
        id: z.string().min(1),
        summary: z
          .string()
          .optional()
          .describe("The event title, so the person knows which one"),
      }),
      execute: async (input) => {
        const hold = await holdOrRun(env, {
          tool: "calendar_delete_event",
          summary: `Delete event ${input.summary || input.id}`,
          args: input,
        })
        if (hold) return hold
        await googleFetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.id)}`,
          { method: "DELETE" }
        )
        return { deleted: true, id: input.id }
      },
    })
  }

  return tools
}
