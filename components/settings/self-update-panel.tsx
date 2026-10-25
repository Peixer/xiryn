"use client"

import * as React from "react"
import {
  CheckIcon,
  XIcon,
  CircleIcon,
  SearchIcon,
  HammerIcon,
  ArrowRightLeftIcon,
  AlertTriangleIcon,
  CloudIcon,
  RefreshCwIcon,
} from "lucide-react"

import {
  checkForUpdates,
  decideSelfUpdate,
  stageSelfUpdate,
  startSelfUpdate,
} from "@/actions/self-update"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
    impact: string | null
  } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const [checking, setChecking] = React.useState(false)
  const [clock, setClock] = React.useState(() => Date.now())
  const logRef = React.useRef<HTMLOListElement>(null)
  const [queued, setQueued] = React.useState(false)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const acceptView = React.useCallback((next: SelfUpdateView) => {
    setView(next)
    if (["building", "ready", "switching"].includes(next.phase)) setQueued(false)
  }, [])

  React.useEffect(() => {
    // The card is inserted under the buttons. On a phone that sits below the
    // fold, so bring it into the panel's own scroller.
    cardRef.current?.scrollIntoView({ block: "end" })
  }, [card])

  React.useEffect(() => {
    const source = new EventSource("/api/self-update/progress")
    source.onmessage = (event) => {
      try {
        acceptView(JSON.parse(event.data) as SelfUpdateView)
      } catch {
        // A malformed event is ignored. The next one replaces it.
      }
    }
    return () => source.close()
  }, [acceptView])

  const phase = view?.phase ?? "idle"
  const working = phase === "building" || phase === "switching"
  React.useEffect(() => {
    if (phase === "idle" && !queued) return
    const controller = new AbortController()
    const timer = setInterval(() => {
      setClock(Date.now())
      void fetch("/api/self-update/status", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((next: SelfUpdateView | null) => {
          if (next) acceptView(next)
        })
        .catch(() => {
          /* EventSource will reconnect as well. */
        })
    }, 5000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [phase, queued, acceptView])
  React.useEffect(() => {
    if (!queued) return
    const timer = setTimeout(() => {
      setQueued(false)
      setError(
        "The deploy helper did not start within 30 seconds. Check systemctl status xiryn-deploy.path xiryn-deploy.service on the server, then retry Update."
      )
    }, 30_000)
    return () => clearTimeout(timer)
  }, [queued])
  React.useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [view?.logs])
  const shownPhase = busy === "update" || queued ? "checking" : phase
  const phaseIndex = ["idle", "checking", "building", "ready", "switching"].indexOf(
    shownPhase
  )
  const buildStart = view?.logs.findLast((line) => line.step === "build")?.ts
  const elapsed = buildStart ? Math.max(0, (clock - Date.parse(buildStart)) / 1000) : 0
  const failure = error ?? view?.error
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
  const canCheck = Boolean(view?.configured && !working && !checking)

  const checkNow = async () => {
    setChecking(true)
    setError(null)
    try {
      const result = await checkForUpdates()
      if (!result.ok) setError(result.error ?? "Could not check for updates.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check for updates.")
    } finally {
      setChecking(false)
    }
  }

  const run = async (
    label: string,
    action: () => Promise<{ ok: boolean; error?: string }>
  ) => {
    setBusy(label)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(result.error ?? "That did not start.")
      else if (label === "update") setQueued(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not contact the update service. Retry when the connection returns."
      )
    } finally {
      setBusy(null)
    }
  }

  const stage = async (op: "switch" | "rollback") => {
    setBusy(op)
    setError(null)
    setConfirmDiscard(false)
    let result: Awaited<ReturnType<typeof stageSelfUpdate>>
    try {
      result = await stageSelfUpdate(op)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not stage the update. Retry."
      )
      return
    } finally {
      setBusy(null)
    }
    if (!result.ok) {
      setError(result.error)
      return
    }
    if ("queued" in result && result.queued) {
      setCard(null)
      return
    }
    if ("approvalId" in result && result.approvalId && result.summary) {
      setCard({
        op,
        approvalId: result.approvalId,
        summary: result.summary,
        impact: result.impact ?? null,
      })
    }
  }

  return (
    <div className={cn("flex flex-col gap-4", layout === "phone" && "pb-4")}>
      {!view?.configured &&
        view?.githubUpdate &&
        "enabled" in view.githubUpdate &&
        view.githubUpdate.enabled &&
        view.githubUpdate.available && (
          <div className="flex items-start gap-3 rounded-xl border border-rigel/30 bg-rigel/10 p-4 text-sm">
            <CloudIcon className="mt-0.5 size-4 text-rigel" />
            <div>
              <p className="font-medium text-rigel">
                Update available on GitHub
                {view.githubUpdate.behind !== null &&
                  ` (${view.githubUpdate.behind} commit${view.githubUpdate.behind === 1 ? "" : "s"} behind)`}
              </p>
              <p className="mt-1 text-muted-foreground">
                Pull the latest changes with{" "}
                <code className="font-mono text-[12px]">git pull</code> and restart the
                app.
              </p>
            </div>
          </div>
        )}
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
            ["Current version", short(view?.activeSha ?? null)],
            ["Latest available", short(view?.tipSha ?? null)],
            [
              "Migrations",
              view?.includesMigrations
                ? view.migrations.join(", ")
                : "none in this range",
            ],
            [
              "GitHub status",
              !view?.githubUpdate
                ? "checking..."
                : !("enabled" in view.githubUpdate) || !view.githubUpdate.enabled
                  ? "disabled"
                  : view.githubUpdate.available
                    ? view.githubUpdate.behind !== null
                      ? `${view.githubUpdate.behind} commit${view.githubUpdate.behind === 1 ? "" : "s"} behind`
                      : "update available"
                    : "up to date",
            ],
            [
              "Last checked",
              view?.checkedAt
                ? new Date(view.checkedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "never",
            ],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 px-4 py-2.5"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd title={value} className="min-w-0 truncate text-right">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div
        aria-label="Update phases"
        className="flex flex-wrap gap-3 text-xs"
        role="status"
      >
        {(
          [
            ["idle", CircleIcon],
            ["checking", SearchIcon],
            ["building", HammerIcon],
            ["ready", CheckIcon],
            ["switching", ArrowRightLeftIcon],
          ] as const
        ).map(([name, Icon], index) => (
          <span
            key={name}
            aria-current={shownPhase === name ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1",
              shownPhase === name ? "font-semibold text-rigel" : "text-muted-foreground"
            )}
          >
            {index < phaseIndex ? (
              <CheckIcon className="size-3" />
            ) : (
              <Icon className="size-3" />
            )}
            {name}
          </span>
        ))}
        {(phase === "active" || phase === "rolled_back") && (
          <span>
            <CheckIcon className="inline size-3" /> {phase.replaceAll("_", " ")}
          </span>
        )}
      </div>
      {phase === "building" && (
        <p className="text-sm text-muted-foreground" role="status">
          {elapsed < 120
            ? `Estimated ${Math.max(0, Math.ceil(60 - elapsed))}–${Math.ceil(120 - elapsed)} seconds remaining. Builds usually take 60–120 seconds.`
            : "Build is taking longer than usual. Follow the progress log below."}
        </p>
      )}
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
          <span className="label-mono">What&apos;s new</span>
          <ul className="flex flex-col gap-1 text-[13.5px] leading-relaxed">
            {view.titles.map((title) => (
              <li key={title} className="break-words">
                {title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {failure && (
        <div
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangleIcon className="size-4" /> Update failed
          </p>
          <p className="mt-2 break-words">{failure}</p>
          <p className="mt-2">
            Review the last progress entries below. For a build failure, fix the reported
            dependency or disk-space issue and click Update again. For a switch failure,
            verify the serving colour and retry Switch when healthy. If progress stops,
            inspect <code>journalctl -u xiryn-deploy.service -n 100</code> on the server.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="outline"
          className="min-h-12 sm:min-h-8"
          disabled={!canCheck}
          onClick={checkNow}
        >
          {checking ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          Check for updates
        </Button>
        <Button
          className="min-h-12 sm:min-h-8"
          disabled={!canUpdate || !!busy || queued}
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
      {!view?.updateAvailable &&
        view?.githubUpdate &&
        (view.githubUpdate as { available?: boolean }).available === true && (
          <p className="text-[12.5px] text-muted-foreground">
            Release.json may be stale — click Check for updates
          </p>
        )}
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
          {card.op === "rollback" && card.impact && (
            <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
              {card.impact}
            </p>
          )}
          {card.op === "rollback" && (
            <label className="flex items-start gap-2 text-[13px] leading-relaxed">
              <Checkbox
                checked={confirmDiscard}
                onCheckedChange={(checked) => setConfirmDiscard(checked === true)}
                className="mt-0.5"
              />
              <span>Discard data written since the switch</span>
            </label>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="min-h-12"
              disabled={!!busy || (card.op === "rollback" && !confirmDiscard)}
              onClick={() =>
                run("approve", async () => {
                  const result = await decideSelfUpdate(
                    card.approvalId,
                    "approve",
                    card.op,
                    card.op === "rollback" ? confirmDiscard : undefined
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
        <ol
          ref={logRef}
          aria-label="Update progress log"
          role="log"
          aria-live="polite"
          className="max-h-64 overflow-auto rounded-xl border bg-surface/40 p-3 font-mono text-[11.5px] leading-relaxed"
        >
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
