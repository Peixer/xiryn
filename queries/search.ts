import { sqlite } from "@/db"
import {
  buildSnippet,
  extractMessageText,
  likePattern,
  MAX_RESULTS,
  normalizeQuery,
} from "@/lib/search"

export { MAX_RESULTS }

export type SearchHit = {
  messageId: string
  threadId: string
  title: string | null
  agentId: string | null
  agentName: string | null
  agentGlyph: string | null
  squadId: string | null
  squadName: string | null
  createdAt: Date
  snippet: string
  matchStart: number
  matchEnd: number
  leadingEllipsis: boolean
  trailingEllipsis: boolean
  href: string
}

type SearchRow = {
  message_id: string
  thread_id: string
  parts: string
  created_at: number
  title: string | null
  agent_id: string | null
  squad_id: string | null
  agent_name: string | null
  agent_glyph: string | null
  squad_name: string | null
}

// LIKE over the stored JSON is only a prefilter: keys such as "text" and
// escaped characters produce false hits. Each row is confirmed against the
// extracted prose. No FTS index — that would need a migration — so this
// function is the only place that query lives.
const SEARCH_SQL = `
  SELECT m.id AS message_id,
         m.thread_id AS thread_id,
         m.parts AS parts,
         m.created_at AS created_at,
         t.title AS title,
         t.agent_id AS agent_id,
         t.squad_id AS squad_id,
         a.name AS agent_name,
         a.glyph AS agent_glyph,
         s.name AS squad_name
  FROM messages m
  INNER JOIN threads t ON t.id = m.thread_id
  LEFT JOIN agents a ON a.id = t.agent_id
  LEFT JOIN squads s ON s.id = t.squad_id
  WHERE m.role IN ('user', 'assistant')
    AND m.parts LIKE ? ESCAPE '\\'
    AND (? IS NULL OR t.agent_id = ?)
    AND (? IS NULL OR t.squad_id = ?)
  ORDER BY m.created_at DESC, m.id DESC
`

function cleanId(value: string | null | undefined) {
  const id = value?.trim()
  return id ? id : null
}

export function searchMessages(input: {
  query: string
  agentId?: string | null
  squadId?: string | null
}): SearchHit[] {
  const query = normalizeQuery(input.query)
  if (!query) return []

  const agentId = cleanId(input.agentId)
  const squadId = cleanId(input.squadId)
  const rows = sqlite
    .prepare(SEARCH_SQL)
    .iterate(
      likePattern(query),
      agentId,
      agentId,
      squadId,
      squadId
    ) as Iterable<SearchRow>

  const hits: SearchHit[] = []
  for (const row of rows) {
    let parts: unknown
    try {
      parts = JSON.parse(row.parts)
    } catch {
      continue
    }
    const snippet = buildSnippet(extractMessageText(parts), query)
    if (!snippet) continue
    if (!row.agent_id && !row.squad_id) continue
    hits.push({
      messageId: row.message_id,
      threadId: row.thread_id,
      title: row.title,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentGlyph: row.agent_glyph,
      squadId: row.squad_id,
      squadName: row.squad_name,
      createdAt: new Date(row.created_at),
      snippet: snippet.text,
      matchStart: snippet.matchStart,
      matchEnd: snippet.matchEnd,
      leadingEllipsis: snippet.leadingEllipsis,
      trailingEllipsis: snippet.trailingEllipsis,
      href: row.agent_id
        ? `/a/${row.agent_id}/${row.thread_id}`
        : `/s/${row.squad_id}/${row.thread_id}`,
    })
    if (hits.length >= MAX_RESULTS) break
  }
  return hits
}
