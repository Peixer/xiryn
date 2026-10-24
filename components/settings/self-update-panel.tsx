"use client"

import * as React from "react"
import { CheckIcon, XIcon } from "lucide-react"

import { decideSelfUpdate, stageSelfUpdate, startSelfUpdate } from "@/actions/self-update"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { SelfUpdateView } from "@/lib/self-update/status"
import { cn } from "@/lib/utils"

function short(sha: string | null) {
  return sha ? sha.slice(0, 12) : "unknown"
}

export function SelfUpdatePanel({
  initial,
  layout = "page",
}: {
  initial?: SelfUpdateView | null
  layout?: "page" | "phone"
}) {
  const [view, setView] = React.useState<SelfUpdateView | null>(initial ?? null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [card, setCard] = React.useState<{
    op: "switch" | "rollback"
    approvalId: string
    summary: string
  } | null>(null)
  const cardRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    // The card is inserted under the buttons. On a phone that sits below the
    // fold, so bring it into the panel's own scroller.
    cardRef.current?.scrollIntoView({ block: "end" })
  }, [card])

  React.useEffect(() => {
    const source = new EventSource("/api/self-update/progress")
    source.onmessage = (event) => {
      try {
        setView(JSON.parse(event.data) as SelfUpdateView)
      } catch {
        // A malformed event is ignored. The next one replaces it.
      }
    }
    return () => source.close()
  }, [])

  const phase = view?.phase ?? "idle"
  const working = phase === "building" || phase === "switching"
  const canUpdate = Boolean(view?.configured && view.updateAvailable && !working)
  const canSwitch = Boolean(
    view?.configured &&
    view.candidateSha &&
    (phase === "ready" || phase === "rolled_back") &&
    !working
  )
  const canRollback = Boolean(
    view?.configured && phase === "active" && view.previousSha && !working
  )

  const run = async (
    label: string,
    action: () => Promise<{ ok: boolean; error?: string }>
  ) => {
    setBusy(label)
    setError(null)
    const result = await action()
    setBusy(null)
    if (!result.ok) setError(result.error ?? "That did not start.")
  }

  const stage = async (op: "switch" | "rollback") => {
    setBusy(op)
    setError(null)
    const result = await stageSelfUpdate(op)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if ("queued" in result && result.queued) {
      setCard(null)
      return
    }
    if ("approvalId" in result && result.approvalId && result.summary) {
      setCard({ op, approvalId: result.approvalId, summary: result.summary })
    }
  }

  return (
    <div className={cn("flex flex-col gap-4", layout === "phone" && "pb-4")}>
      {!view?.configured && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          This install is still a single copy. After{" "}
          <code className="font-mono text-[12px]">deploy/migrate-blue-green.sh</code>,
          this screen can build the other colour and switch with your approval.
        </p>
      )}
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-surface/50 font-mono text-[12px] sm:grid-cols-2">
        {(
          [
            ["Colour", view?.active ?? "blue"],
            ["Phase", phase.replaceAll("_", " ")],
            ["Branch", view?.branch ?? "main"],
            ["This commit", short(view?.activeSha ?? null)],
            ["Latest", short(view?.tipSha ?? null)],
            [
              "Migrations",
              view?.includesMigrations
                ? view.migrations.join(", ")
                : "none in this range",
            ],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 px-4 py-2.5"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {view?.standbyUrl && (
        <p className="text-[12.5px] text-muted-foreground">
          The inactive colour is at{" "}
          <a className="text-rigel underline" href={view.standbyUrl}>
            {view.standbyUrl}
          </a>
          , behind the same login.
        </p>
      )}
      {view && view.titles.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="label-mono">Changelog</span>
          <ul className="flex flex-col gap-1 text-[13.5px] leading-relaxed">
            {view.titles.map((title) => (
              <li key={title} className="break-words">
                {title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view?.error && <p className="text-[13px] text-destructive">{view.error}</p>}
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          className="min-h-12 sm:min-h-8"
          disabled={!canUpdate || !!busy}
          onClick={() => run("update", startSelfUpdate)}
        >
          {busy === "update" && <Spinner data-icon="inline-start" />}
          Update
        </Button>
        <Button
          variant="outline"
          className="min-h-12 sm:min-h-8"
          disabled={!canSwitch || !!busy}
          onClick={() => stage("switch")}
        >
          {busy === "switch" && <Spinner data-icon="inline-start" />}
          Switch
        </Button>
        <Button
          variant="outline"
          className="min-h-12 sm:min-h-8"
          disabled={!canRollback || !!busy}
          onClick={() => stage("rollback")}
        >
          {busy === "rollback" && <Spinner data-icon="inline-start" />}
          Roll back
        </Button>
      </div>
      {card && (
        <div
          ref={cardRef}
          className="flex flex-col gap-3 rounded-xl border border-betelgeuse/30 bg-betelgeuse-soft p-4"
        >
          <span className="font-mono text-[11px] text-betelgeuse">
            Approval · nothing changes until you choose
          </span>
          <pre className="font-sans text-[15px] leading-relaxed break-words whitespace-pre-wrap">
            {card.summary}
          </pre>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="min-h-12"
              disabled={!!busy}
              onClick={() =>
                run("approve", async () => {
                  const result = await decideSelfUpdate(
                    card.approvalId,
                    "approve",
                    card.op
                  )
                  if (result.ok) setCard(null)
                  return result
                })
              }
            >
              {busy === "approve" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckIcon data-icon="inline-start" />
              )}
              Approve
            </Button>
            <Button
              variant="outline"
              className="min-h-12"
              disabled={!!busy}
              onClick={() =>
                run("decline", async () => {
                  const result = await decideSelfUpdate(
                    card.approvalId,
                    "decline",
                    card.op
                  )
                  if (result.ok) setCard(null)
                  return result
                })
              }
            >
              {busy === "decline" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <XIcon data-icon="inline-start" />
              )}
              Decline
            </Button>
          </div>
        </div>
      )}
      {view && view.logs.length > 0 && (
        <ol className="max-h-64 overflow-auto rounded-xl border bg-surface/40 p-3 font-mono text-[11.5px] leading-relaxed">
          {view.logs.map((line, index) => (
            <li key={`${line.ts}-${index}`} className="break-words">
              <span className="text-muted-foreground">{line.step}</span> {line.message}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
