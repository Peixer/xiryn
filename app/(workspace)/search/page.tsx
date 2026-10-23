import type { Metadata } from "next"
import Link from "next/link"
import { format } from "date-fns"

import { Glyph } from "@/components/glyph"
import { normalizeQuery } from "@/lib/search"
import { cn } from "@/lib/utils"
import { MAX_RESULTS, searchMessages, type SearchHit } from "@/queries/search"
import { getAgents, getSquads } from "@/queries/workspace"

export const metadata: Metadata = { title: "Search" }

// Reads the local message store, so never prerender it.
export const dynamic = "force-dynamic"

const fieldClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

function matchLabel(count: number) {
  if (count >= MAX_RESULTS) return `${MAX_RESULTS} newest matches`
  return `${count} ${count === 1 ? "match" : "matches"}`
}

function one(value: string | string[] | undefined) {
  const picked = Array.isArray(value) ? value[0] : value
  return picked ?? ""
}

function Snippet({ hit }: { hit: SearchHit }) {
  return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      {hit.leadingEllipsis ? "…" : null}
      {hit.snippet.slice(0, hit.matchStart)}
      <mark className="rounded-sm bg-rigel-soft px-0.5 text-foreground">
        {hit.snippet.slice(hit.matchStart, hit.matchEnd)}
      </mark>
      {hit.snippet.slice(hit.matchEnd)}
      {hit.trailingEllipsis ? "…" : null}
    </p>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[]
    agent?: string | string[]
    squad?: string | string[]
  }>
}) {
  const params = await searchParams
  const raw = one(params.q)
  const agentId = one(params.agent).trim()
  const squadId = one(params.squad).trim()
  const query = normalizeQuery(raw)
  const tooShort = raw.trim().length > 0 && !query
  const hits = query ? searchMessages({ query, agentId, squadId }) : []
  const agents = getAgents()
  const squads = getSquads()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="label-mono">{"// search · messages"}</span>
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Find a phrase in anything you or an agent wrote, across every thread. Matches
            stay on this computer. Tool output is left out, so command results are not
            shown.
          </p>
        </header>

        <form action="/search" className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              name="q"
              defaultValue={raw}
              placeholder="Search messages…"
              aria-label="Search messages"
              autoFocus
              className={cn(fieldClass, "h-9")}
            />
            <button
              type="submit"
              className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              Search
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="label-mono">Agent</span>
              <select name="agent" defaultValue={agentId} className={fieldClass}>
                <option value="">Any agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono">Squad</span>
              <select name="squad" defaultValue={squadId} className={fieldClass}>
                <option value="">Any squad</option>
                {squads.map((squad) => (
                  <option key={squad.id} value={squad.id}>
                    {squad.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </form>

        {tooShort ? (
          <p className="font-mono text-[12px] text-muted-foreground">
            Type at least 2 characters.
          </p>
        ) : !query ? (
          <p className="font-mono text-[12px] text-muted-foreground">
            Type a word or a phrase. Two characters or more.
          </p>
        ) : hits.length === 0 ? (
          <p className="font-mono text-[12px] text-muted-foreground">
            Nothing in your threads matches “{query}”.
          </p>
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="label-mono">{matchLabel(hits.length)}</h2>
            <ol className="divide-y rounded-xl border bg-surface/50">
              {hits.map((hit) => {
                const owner = hit.agentName ?? hit.squadName ?? "Unknown"
                return (
                  <li key={hit.messageId}>
                    <Link
                      href={hit.href}
                      className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {hit.agentGlyph ? (
                          <Glyph seed={hit.agentGlyph} className="size-5" />
                        ) : null}
                        <span className="truncate font-medium">
                          {hit.title ?? "New thread"}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-faint">
                        {owner}
                        {hit.squadName && !hit.agentName ? " · squad" : ""}
                        {" · "}
                        {format(hit.createdAt, "d MMM yyyy, HH:mm")}
                      </span>
                      <Snippet hit={hit} />
                    </Link>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}
