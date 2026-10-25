"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
type Session = {
  id: string
  agentName: string
  task: string
  tool: string
  branch: string
  status: "running" | "done" | "failed" | "cancelled"
  startedAt: string
  durationMs?: number
  error?: string
  threadId?: string
  threadTitle?: string | null
  threadHref?: string
}
function useSessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const response = await fetch("/api/work-sessions", {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!response.ok) throw new Error("Unable to load sessions")
        const data = await response.json()
        setSessions(data.sessions)
        setError("")
      } catch {
        if (!controller.signal.aborted) setError("Unable to load sessions")
      }
      // Keep discovery alive even when the last known session has finished.
      if (!controller.signal.aborted) timer = setTimeout(tick, 3000)
    }
    void tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [])
  return { sessions, error }
}
export function SessionsLink() {
  const { sessions } = useSessions()
  const count = sessions?.filter((s) => s.status === "running").length ?? 0
  return (
    <Link
      href="/sessions"
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
    >
      Sessions{" "}
      {count > 0 && (
        <span className="rounded-full bg-rigel/15 px-2 text-rigel">{count}</span>
      )}
    </Link>
  )
}
function SessionRow({ session: s }: { session: Session }) {
  const [expanded, setExpanded] = useState(false)
  const [output, setOutput] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const [copyError, setCopyError] = useState("")
  useEffect(() => {
    if (s.status !== "running") return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [s.status])
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const response = await fetch(
          `/api/work-sessions/${encodeURIComponent(s.id)}/output`,
          { signal: controller.signal, cache: "no-store" }
        )
        if (!response.ok) throw new Error()
        const data = await response.json()
        setOutput(data.output.split("\n").slice(-20).join("\n"))
      } catch {
        if (!controller.signal.aborted) setOutput("Unable to load output")
      }
      if (!controller.signal.aborted && s.status === "running")
        timer = setTimeout(tick, 3000)
    }
    void tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [expanded, s.id, s.status])
  const seconds = Math.max(
    0,
    Math.floor(
      (s.status === "running" ? now - Date.parse(s.startedAt) : (s.durationMs ?? 0)) /
        1000
    )
  )
  return (
    <article className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{s.agentName}</strong>
        <span>
          {s.tool === "codex" ? "⚡" : "🤖"} {s.tool}
        </span>
        <span
          className={cn(
            "ml-auto flex items-center gap-1 text-xs",
            s.status === "running"
              ? "text-ok"
              : s.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {s.status === "running" ? (
            <span className="size-2 animate-pulse rounded-full bg-ok" />
          ) : s.status === "done" ? (
            "✓"
          ) : (
            "✕"
          )}{" "}
          {s.status}
        </span>
        <span className="font-mono text-xs">
          {Math.floor(seconds / 60)}m {seconds % 60}s
        </span>
      </div>
      <p className="text-sm">
        {s.task.slice(0, 80)}
        {s.task.length > 80 && "…"}
      </p>
      {s.threadHref && (
        <Link href={s.threadHref} className="text-xs text-rigel">
          {s.threadTitle?.trim() || "Conversation"}
        </Link>
      )}
      <div className="flex items-center gap-2">
        <code className="text-xs break-all">{s.branch || "Preparing branch…"}</code>
        <button
          type="button"
          className="text-xs text-rigel"
          onClick={() => {
            void navigator.clipboard
              .writeText(s.branch)
              .catch(() => setCopyError("Could not copy branch"))
          }}
        >
          Copy branch
        </button>
        {copyError && <span role="status">{copyError}</span>}
      </div>
      {s.error && <p className="text-sm text-destructive">{s.error}</p>}
      <button
        type="button"
        className="text-xs text-muted-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Hide output" : "Show output"}
      </button>
      {expanded && (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {output || "Waiting for output…"}
        </pre>
      )}
    </article>
  )
}
export function SessionsPanel() {
  const { sessions, error } = useSessions()
  if (error) return <p role="alert">{error}</p>
  if (!sessions) return <Spinner />
  return (
    <div className="space-y-3">
      {sessions.length ? (
        sessions.map((s) => <SessionRow key={s.id} session={s} />)
      ) : (
        <p className="text-sm text-muted-foreground">
          No active sessions. Use spawn_work_session to start parallel coding tasks.
        </p>
      )}
    </div>
  )
}
