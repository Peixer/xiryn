// Plain-text search over stored message parts. The SQL prefilter lives in
// queries/search.ts; everything that decides what a person actually sees is
// here, so a later FTS index can replace the query without changing the rules.

export const MIN_QUERY_LENGTH = 2
export const SNIPPET_LENGTH = 160
export const MAX_RESULTS = 50

// Null when there is nothing to search for yet.
export function normalizeQuery(raw: string) {
  const query = raw.trim()
  if (query.length < MIN_QUERY_LENGTH) return null
  return query
}

// `%` and `_` are LIKE wildcards. `\` is the escape character (ESCAPE '\').
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export function likePattern(query: string) {
  return `%${escapeLike(query)}%`
}

// User and assistant prose only. Tool calls, tool results, reasoning and
// files stay out: they are how secrets and command output would leak into
// a snippet.
export function extractMessageText(parts: unknown) {
  if (!Array.isArray(parts)) return ""
  const chunks: string[] = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const record = part as { type?: unknown; text?: unknown }
    if (record.type !== "text" || typeof record.text !== "string") continue
    const text = record.text.trim()
    if (text) chunks.push(text)
  }
  return chunks.join("\n")
}

export type Snippet = {
  text: string
  matchStart: number
  matchEnd: number
  leadingEllipsis: boolean
  trailingEllipsis: boolean
}

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

// ~160 characters around the first case-insensitive match. The window hugs
// the start or end of the text when the match is there, and centers it
// otherwise. Offsets refer to `text`, which is the collapsed snippet.
export function buildSnippet(text: string, query: string, length = SNIPPET_LENGTH) {
  const haystack = collapse(text)
  const needle = collapse(query)
  if (!needle || length < 1) return null
  const index = haystack.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return null

  const matchLength = needle.length
  let start = 0
  let end = haystack.length
  if (haystack.length > length) {
    if (matchLength >= length) {
      start = index
      end = Math.min(haystack.length, index + length)
    } else {
      const pad = length - matchLength
      start = index - Math.floor(pad / 2)
      end = start + length
      if (start < 0) {
        start = 0
        end = length
      } else if (end > haystack.length) {
        end = haystack.length
        start = end - length
      }
    }
  }

  const snippet = haystack.slice(start, end)
  const matchStart = index - start
  return {
    text: snippet,
    matchStart,
    matchEnd: Math.min(snippet.length, matchStart + matchLength),
    leadingEllipsis: start > 0,
    trailingEllipsis: end < haystack.length,
  } satisfies Snippet
}
