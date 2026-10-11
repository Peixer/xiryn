// Things worth telling the person about, wherever they are in the app. The
// browser follows them over /api/events and turns them into a sound, a
// desktop notification and a notification card.

type Common = {
  threadId: string
  href: string
  // Who answered (the last agent to hold the turn) and their glyph
  name: string
  glyph: string
  // Where the message that started the turn came from
  via: "web" | "telegram"
}

export type OrynEvent =
  | (Common & {
      // A turn began (from the app, Telegram or an answered request): a page
      // showing the thread follows it live
      type: "turn-started"
    })
  | (Common & {
      type: "turn-finished"
      preview: string
      ok: boolean
      error?: string
      durationMs: number
    })
  | (Common & {
      // The agent handed over its screen, wants a payment approved, or
      // needs a detail only the person has
      type: "takeover" | "payment" | "secret"
      reason: string
    })

type Listener = (event: OrynEvent) => void

const globalForEvents = globalThis as unknown as { __orynEvents?: Set<Listener> }
const listeners = (globalForEvents.__orynEvents ??= new Set())

export function emit(event: OrynEvent) {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[oryn] event listener failed:", error)
    }
  }
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// A reply's Markdown as one clean line of text for a notification
export function previewText(markdown: string, max = 240) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    // A table's header row and the rule under it
    .replace(/^[ \t]*\|.*\|[ \t]*\r?\n[ \t]*\|?[ \t]*:?-{3,}.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(
      /^[ \t]*\|(.*)\|[ \t]*$/gm,
      (_, row: string) =>
        `${row
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(" · ")};`
    )
    .replace(/\s+/g, " ")
    .trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}
