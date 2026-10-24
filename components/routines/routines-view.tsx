"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format, formatDistanceToNowStrict } from "date-fns"
import {
  AlarmClockIcon,
  ArrowUpRightIcon,
  HistoryIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import {
  deleteRoutine,
  runRoutineNow,
  saveRoutine,
  setRoutineEnabled,
} from "@/actions/routines"
import { Confirm } from "@/components/confirm"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { useWorkspace } from "@/components/workspace/context"
import type { RoutineSchedule } from "@/db/schema"
import { formatUsd } from "@/lib/providers/pricing"
import { describeSchedule, WEEKDAYS } from "@/lib/schedule"
import { getAgentTemplate, routineTemplates, type RoutineTemplate } from "@/lib/templates"
import { cn } from "@/lib/utils"
import type { RoutineView } from "@/queries/workspace"

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"

type Draft = {
  name: string
  // "agent:<id>" or "squad:<id>"
  owner: string
  prompt: string
  kind: RoutineSchedule["kind"]
  time: string
  day: number
  every: number
  // For a one-off run: "2026-10-21T09:00"
  at: string
}

// Tomorrow at 09:00, as a datetime-local value
function tomorrowAtNine() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`
}

function draftFrom(routine?: RoutineView, template?: RoutineTemplate, owner = ""): Draft {
  const schedule = routine?.schedule ??
    template?.schedule ?? { kind: "daily", time: "08:00" }
  return {
    name: routine?.name ?? template?.name ?? "",
    owner: routine
      ? routine.agentId
        ? `agent:${routine.agentId}`
        : `squad:${routine.squadId}`
      : owner,
    prompt: routine?.prompt ?? template?.prompt ?? "",
    kind: schedule.kind,
    time: "time" in schedule ? schedule.time : "08:00",
    day: schedule.kind === "weekly" ? schedule.day : 1,
    every: schedule.kind === "hourly" ? schedule.every : 6,
    at: schedule.kind === "once" ? schedule.at : tomorrowAtNine(),
  }
}

function scheduleOf(draft: Draft): RoutineSchedule {
  if (draft.kind === "hourly") return { kind: "hourly", every: draft.every }
  if (draft.kind === "weekly") return { kind: "weekly", time: draft.time, day: draft.day }
  if (draft.kind === "once") return { kind: "once", at: draft.at }
  return { kind: draft.kind, time: draft.time }
}

function RoutineDialog({
  open,
  onOpenChange,
  routine,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  routine?: RoutineView
  initial: Draft
}) {
  const router = useRouter()
  const { nav } = useWorkspace()
  const [draft, setDraft] = React.useState(initial)
  const [saving, setSaving] = React.useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(initial)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const [kind, id] = draft.owner.split(":")
            setSaving(true)
            try {
              await saveRoutine(
                {
                  name: draft.name,
                  agentId: kind === "agent" ? id : null,
                  squadId: kind === "squad" ? id : null,
                  prompt: draft.prompt,
                  schedule: scheduleOf(draft),
                  enabled: routine?.enabled ?? true,
                },
                routine?.id
              )
              toast.add({
                type: "success",
                title: routine ? "Routine saved" : "Routine created",
              })
              onOpenChange(false)
              router.refresh()
            } catch (error) {
              toast.add({
                type: "error",
                title: "Couldn't save",
                description: reason(error),
              })
            } finally {
              setSaving(false)
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
            <p className="text-[12.5px] text-muted-foreground">
              An agent does this on its own, on schedule, while Xiryn is running. Results
              land in the routine&apos;s thread, and on Telegram if it&apos;s connected.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Name</span>
            <Input
              value={draft.name}
              maxLength={60}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Morning brief"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Who does it</span>
            <select
              value={draft.owner}
              onChange={(event) => set("owner", event.target.value)}
              className={selectClass}
            >
              <option value="" disabled>
                Pick an agent or a squad
              </option>
              {nav.agents.length > 0 && (
                <optgroup label="Agents">
                  {nav.agents.map((agent) => (
                    <option key={agent.id} value={`agent:${agent.id}`}>
                      {agent.name} — {agent.role}
                    </option>
                  ))}
                </optgroup>
              )}
              {nav.squads.length > 0 && (
                <optgroup label="Squads">
                  {nav.squads.map((squad) => (
                    <option key={squad.id} value={`squad:${squad.id}`}>
                      {squad.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono">What to do each time</span>
            <Textarea
              value={draft.prompt}
              maxLength={4000}
              onChange={(event) => set("prompt", event.target.value)}
              placeholder="Check my favourite blogs for new posts and summarise them."
              className="max-h-48 min-h-24 text-[13px]"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label className="flex flex-col gap-1.5">
              <span className="label-mono">When</span>
              <select
                value={draft.kind}
                onChange={(event) => set("kind", event.target.value as Draft["kind"])}
                className={selectClass}
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Once a week</option>
                <option value="hourly">Every few hours</option>
                <option value="once">Just once</option>
              </select>
            </label>
            {draft.kind === "once" ? (
              <label className="flex flex-col gap-1.5">
                <span className="label-mono">On</span>
                <input
                  type="datetime-local"
                  value={draft.at}
                  onChange={(event) => set("at", event.target.value.slice(0, 16))}
                  className={cn(selectClass, "font-mono")}
                />
              </label>
            ) : draft.kind === "hourly" ? (
              <label className="flex flex-col gap-1.5">
                <span className="label-mono">Every</span>
                <select
                  value={draft.every}
                  onChange={(event) => set("every", Number(event.target.value))}
                  className={selectClass}
                >
                  {[1, 2, 3, 4, 6, 8, 12, 24].map((hours) => (
                    <option key={hours} value={hours}>
                      {hours === 1 ? "hour" : `${hours} hours`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="flex gap-2">
                {draft.kind === "weekly" && (
                  <label className="flex flex-1 flex-col gap-1.5">
                    <span className="label-mono">Day</span>
                    <select
                      value={draft.day}
                      onChange={(event) => set("day", Number(event.target.value))}
                      className={selectClass}
                    >
                      {WEEKDAYS.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="label-mono">At</span>
                  <input
                    type="time"
                    value={draft.time}
                    onChange={(event) => set("time", event.target.value)}
                    className={cn(selectClass, "font-mono")}
                  />
                </label>
              </div>
            )}
          </div>
          <p className="-mt-1 font-mono text-[11px] text-muted-foreground">
            {describeSchedule(scheduleOf(draft))} · this computer&apos;s time
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                saving || !draft.name.trim() || !draft.owner || !draft.prompt.trim()
              }
            >
              {saving && <Spinner data-icon="inline-start" />}
              {routine ? "Save" : "Create routine"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Owner({ routine }: { routine: RoutineView }) {
  const { nav } = useWorkspace()
  const agent = routine.agentId ? nav.agents.find((a) => a.id === routine.agentId) : null
  const squad = routine.squadId ? nav.squads.find((s) => s.id === routine.squadId) : null
  if (agent) {
    return (
      <span className="flex items-center gap-1.5">
        <Glyph seed={agent.glyph} className="size-4 rounded-[4px]" />
        {agent.name}
      </span>
    )
  }
  if (squad) {
    return (
      <span className="flex items-center gap-1.5">
        <SquadGlyph seeds={squad.glyphs} className="size-4" />
        {squad.name}
      </span>
    )
  }
  return null
}

function Status({ routine }: { routine: RoutineView }) {
  if (routine.lastStatus === "running") {
    return (
      <span className="flex items-center gap-1.5 text-rigel">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-rigel text-rigel" />
        running
      </span>
    )
  }
  if (!routine.lastRunAt && routine.lastStatus !== "skipped") {
    return <span className="text-faint">not run yet</span>
  }
  const when = routine.lastRunAt
    ? `${formatDistanceToNowStrict(new Date(routine.lastRunAt))} ago`
    : ""
  const status = routine.lastStatus ?? "ok"
  return (
    <span className={tones[status]} title={routine.lastError ?? undefined}>
      {status === "ok"
        ? `ran ${when}`
        : status === "skipped"
          ? "skipped"
          : `${status} ${when}`}
    </span>
  )
}

type Run = RoutineView["history"][number]

const tones: Record<Run["status"], string> = {
  running: "text-rigel",
  ok: "text-ok",
  failed: "text-destructive",
  stopped: "text-muted-foreground",
  skipped: "text-warn",
}

function formatDuration(ms: number) {
  if (ms < 1000) return "<1s"
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function RunCost({ cost }: { cost: Run["cost"] }) {
  if (!cost) return null
  if (cost.free) return <span className="text-ok">free</span>
  if (cost.usd === null) return <span title="This model's price isn't known">—</span>
  return <span>{formatUsd(cost.usd)}</span>
}

function History({ routine }: { routine: RoutineView }) {
  const { runs, skipped, usd } = routine.totals
  return (
    <div className="flex flex-col gap-2 border-t pt-3 font-mono text-[11px]">
      <span className="flex flex-wrap gap-x-3 text-muted-foreground">
        <span>
          {runs} {runs === 1 ? "run" : "runs"}
        </span>
        {skipped > 0 && <span className="text-warn">{skipped} skipped</span>}
        {runs > 0 && <span>{formatUsd(usd)} in all</span>}
      </span>
      <ol className="flex flex-col gap-1.5">
        {routine.history.map((run) => (
          <li key={run.id} className="grid grid-cols-[3.75rem_1fr_auto] gap-x-2">
            <span className={tones[run.status]}>{run.status}</span>
            <span className="flex min-w-0 flex-col text-muted-foreground">
              <span>
                <span className="text-foreground">
                  {format(new Date(run.at), "EEE d MMM, HH:mm")}
                </span>
                {run.trigger === "manual" ? " · by hand" : ""}
                {run.durationMs !== null && ` · ${formatDuration(run.durationMs)}`}
              </span>
              {run.detail && (
                <span className="truncate" title={run.detail}>
                  {run.detail}
                </span>
              )}
            </span>
            <span className="text-right text-muted-foreground">
              <RunCost cost={run.cost} />
            </span>
          </li>
        ))}
      </ol>
      {runs + skipped > routine.history.length && (
        <span className="text-faint">the latest {routine.history.length} are shown</span>
      )}
    </div>
  )
}

function RoutineCard({ routine }: { routine: RoutineView }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [showHistory, setShowHistory] = React.useState(false)
  const entries = routine.totals.runs + routine.totals.skipped
  const [busy, setBusy] = React.useState<"run" | "toggle" | null>(null)

  const run = async () => {
    setBusy("run")
    const result = await runRoutineNow(routine.id)
    setBusy(null)
    if (!result.ok) {
      toast.add({ type: "error", title: "Couldn't run it", description: result.error })
      return
    }
    toast.add({ type: "success", title: `${routine.name} is running` })
    if (result.href) router.push(result.href)
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface/50 p-4",
        !routine.enabled && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <AlarmClockIcon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            routine.enabled ? "text-rigel" : "text-muted-foreground"
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] font-semibold">{routine.name}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <Owner routine={routine} />
            <span>{routine.when}</span>
            {routine.enabled && routine.nextRunAt && (
              <span>
                next in {formatDistanceToNowStrict(new Date(routine.nextRunAt))}
              </span>
            )}
            <Status routine={routine} />
          </span>
        </div>
        <label className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <Checkbox
            checked={routine.enabled}
            disabled={busy === "toggle"}
            onCheckedChange={async (checked) => {
              setBusy("toggle")
              try {
                await setRoutineEnabled(routine.id, checked)
                router.refresh()
              } catch (error) {
                toast.add({
                  type: "error",
                  title: "Couldn't change it",
                  description: reason(error),
                })
              } finally {
                setBusy(null)
              }
            }}
          />
          on
        </label>
      </div>
      <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
        {routine.prompt}
      </p>
      {routine.lastStatus === "failed" && routine.lastError && (
        <p className="font-mono text-[11px] break-words text-destructive">
          {routine.lastError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!!busy || routine.lastStatus === "running"}
          onClick={run}
        >
          {busy === "run" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PlayIcon data-icon="inline-start" />
          )}
          Run now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        {routine.href && (
          <Button
            size="sm"
            variant="ghost"
            render={<Link href={routine.href} />}
            nativeButton={false}
          >
            <ArrowUpRightIcon data-icon="inline-start" />
            Results
          </Button>
        )}
        {entries > 0 && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((shown) => !shown)}
          >
            <HistoryIcon data-icon="inline-start" />
            History
            <span className="font-mono text-[11px] text-muted-foreground">{entries}</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          onClick={() => setDeleting(true)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </div>
      {showHistory && <History routine={routine} />}
      {editing && (
        <RoutineDialog
          open={editing}
          onOpenChange={setEditing}
          routine={routine}
          initial={draftFrom(routine)}
        />
      )}
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete "${routine.name}"?`}
        description="It stops running. Its thread and everything the agent wrote there are kept."
        action="Delete routine"
        onConfirm={async () => {
          await deleteRoutine(routine.id)
          router.refresh()
        }}
      />
    </div>
  )
}

export function RoutinesView({ routines }: { routines: RoutineView[] }) {
  const router = useRouter()
  const { nav } = useWorkspace()
  const [creating, setCreating] = React.useState<Draft | null>(null)

  // Follow runs while they happen
  const running = routines.some((r) => r.lastStatus === "running")
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(timer)
  }, [running, router])

  const fromTemplate = (template: RoutineTemplate) => {
    const preset = getAgentTemplate(template.agent)
    const match = nav.agents.find((agent) => agent.name === preset?.name)
    const owner = match
      ? `agent:${match.id}`
      : nav.agents[0]
        ? `agent:${nav.agents[0].id}`
        : ""
    setCreating(draftFrom(undefined, template, owner))
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() =>
            setCreating(
              draftFrom(
                undefined,
                undefined,
                nav.agents[0] ? `agent:${nav.agents[0].id}` : ""
              )
            )
          }
          disabled={nav.agents.length === 0}
        >
          <PlusIcon data-icon="inline-start" />
          New routine
        </Button>
        {nav.agents.length === 0 && (
          <span className="text-[12.5px] text-muted-foreground">
            Create an agent first —{" "}
            <Link href="/templates" className="underline underline-offset-2">
              templates
            </Link>{" "}
            make it quick.
          </span>
        )}
      </div>

      {routines.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {routines.map((routine) => (
            <RoutineCard key={routine.id} routine={routine} />
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <span className="label-mono">{"// ideas"}</span>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {routineTemplates.map((template) => {
            const preset = getAgentTemplate(template.agent)
            return (
              <button
                key={template.id}
                type="button"
                disabled={nav.agents.length === 0}
                onClick={() => fromTemplate(template)}
                className="flex flex-col gap-1.5 rounded-xl border bg-surface/50 p-3.5 text-left transition-colors hover:border-input hover:bg-accent/30 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex items-center gap-2 text-[13.5px] font-medium">
                  {preset && (
                    <Glyph seed={preset.glyph} className="size-4 rounded-[4px]" />
                  )}
                  {template.name}
                </span>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {describeSchedule(template.schedule)} · suits {preset?.name}
                </span>
                <span className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                  {template.prompt}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {creating && (
        <RoutineDialog
          open={!!creating}
          onOpenChange={(open) => !open && setCreating(null)}
          initial={creating}
        />
      )}
    </div>
  )
}
