"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import {
  ArrowUpRightIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"

import { deleteAgent } from "@/actions/agents"
import {
  haltWorkstation,
  wipeWorkstation,
  workstationStatus,
} from "@/actions/workstation"
import { reportDeletion } from "@/components/agents/delete-feedback"
import { Confirm } from "@/components/confirm"
import { Glyph } from "@/components/glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useWorkspace } from "@/components/workspace/context"
import type { WorkstationStatus } from "@/lib/workstation"
import { cn } from "@/lib/utils"
import type { AgentOverview } from "@/queries/workspace"

type Machine =
  { state: "loading" } | { state: "error"; error: string } | WorkstationStatus

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

function size(bytes: number | null) {
  if (bytes === null) return null
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
}

function MachineBadge({ machine }: { machine: Machine }) {
  const base =
    "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px font-mono text-[10.5px]"
  switch (machine.state) {
    case "loading":
      return (
        <span className={cn(base, "text-faint")}>
          <Spinner className="size-2.5" />
          workstation…
        </span>
      )
    case "error":
      return (
        <span className={cn(base, "text-warn")} title={machine.error}>
          workstation unknown
        </span>
      )
    case "no-docker":
      return (
        <span className={cn(base, "text-muted-foreground")} title={machine.detail}>
          docker {machine.reason === "missing" ? "missing" : "off"}
        </span>
      )
    case "unprovisioned":
      return <span className={cn(base, "text-faint")}>no machine yet</span>
    case "running":
    case "starting":
      return (
        <span
          className={cn(base, "border-ok/30 text-ok")}
          title={`${machine.container} · ${machine.cpus} cpu · ${machine.memoryGb.toFixed(1)} GB`}
        >
          <span className="size-1.5 rounded-full bg-ok" />
          {machine.state}
          {size(machine.diskBytes) && ` · ${size(machine.diskBytes)}`}
        </span>
      )
    case "stopped":
      return (
        <span className={cn(base, "text-muted-foreground")} title={machine.container}>
          <span className="size-1.5 rounded-full bg-faint" />
          stopped
        </span>
      )
  }
}

// What the confirmation says is about to go, spelled out
function DeletionNotice({ agent, machine }: { agent: AgentOverview; machine: Machine }) {
  const dying = agent.squads.filter((squad) => squad.members <= 1)
  const staying = agent.squads.filter((squad) => squad.members > 1)
  return (
    <div className="flex flex-col gap-2.5 text-left">
      {agent.busy && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 font-medium text-destructive">
          {agent.name} is working right now. Its current task will be stopped first.
        </p>
      )}
      <p>This permanently deletes {agent.name} and everything that belongs to it:</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>
          {plural(agent.threads, "thread")} with {plural(agent.messages, "message")}
        </li>
        <li>{plural(agent.memories, "memory note")}</li>
        <li>{plural(agent.routines, "routine")}</li>
        <li>
          its workstation: the Docker container, its desktop and every file in its home
          folder
          {machine.state === "no-docker" &&
            " (Docker isn't running, so it's removed in the background once Docker is back)"}
          {machine.state === "unprovisioned" && " (it hasn't been created yet)"}
        </li>
      </ul>
      {staying.length > 0 && (
        <p>
          It leaves {staying.map((squad) => squad.name).join(", ")}; the{" "}
          {staying.length === 1
            ? "squad and its threads stay"
            : "squads and their threads stay"}
          .
        </p>
      )}
      {dying.length > 0 && (
        <p>
          {dying.map((squad) => squad.name).join(", ")}{" "}
          {dying.length === 1 ? "has" : "have"} no one else, so{" "}
          {dying.length === 1 ? "it is" : "they are"} deleted with its threads.
        </p>
      )}
      <p>Usage history stays in the ledger without a name. This can&apos;t be undone.</p>
    </div>
  )
}

function AgentCard({
  agent,
  machine,
  onMachineChange,
}: {
  agent: AgentOverview
  machine: Machine
  onMachineChange: () => void
}) {
  const router = useRouter()
  const { nav, openAgentDialog } = useWorkspace()
  const [deleting, setDeleting] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [busy, setBusy] = React.useState<"stop" | null>(null)
  const navAgent = nav.agents.find((a) => a.id === agent.id)
  const latest = navAgent?.latestThreadId
  const hasMachine =
    machine.state === "running" ||
    machine.state === "starting" ||
    machine.state === "stopped"

  const stop = async () => {
    setBusy("stop")
    try {
      await haltWorkstation(agent.id)
      onMachineChange()
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't stop the workstation",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
      <div className="flex items-start gap-3">
        <Glyph seed={agent.glyph} className="size-10 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{agent.name}</span>
            {agent.busy && (
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-rigel">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-rigel text-rigel" />
                working
              </span>
            )}
          </span>
          <span className="truncate text-[12.5px] text-muted-foreground">
            {agent.role}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 font-mono text-[11px] text-muted-foreground">
            <span title="Model">
              {agent.effectiveModel ?? "no model configured"}
              {!agent.model && agent.effectiveModel && (
                <span className="text-faint"> (default)</span>
              )}
            </span>
            <MachineBadge machine={machine} />
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>{plural(agent.threads, "thread")}</span>
        <span>{plural(agent.messages, "message")}</span>
        <span>{plural(agent.memories, "memory note")}</span>
        <span>{plural(agent.routines, "routine")}</span>
        {agent.squads.length > 0 && (
          <span>squads: {agent.squads.map((squad) => squad.name).join(", ")}</span>
        )}
        <span className="text-faint">
          {agent.lastActiveAt
            ? `active ${formatDistanceToNowStrict(new Date(agent.lastActiveAt))} ago`
            : `created ${formatDistanceToNowStrict(new Date(agent.createdAt))} ago`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          render={<Link href={latest ? `/a/${agent.id}/${latest}` : `/a/${agent.id}`} />}
          nativeButton={false}
        >
          <ArrowUpRightIcon data-icon="inline-start" />
          Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!navAgent}
          onClick={() => navAgent && openAgentDialog({ agent: navAgent })}
        >
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        {(machine.state === "running" || machine.state === "starting") && (
          <Button size="sm" variant="ghost" disabled={busy === "stop"} onClick={stop}>
            {busy === "stop" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PowerIcon data-icon="inline-start" />
            )}
            Stop machine
          </Button>
        )}
        {hasMachine && (
          <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
            <RotateCcwIcon data-icon="inline-start" />
            Reset machine
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => setDeleting(true)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </div>

      <Confirm
        open={resetting}
        onOpenChange={setResetting}
        title={`Reset ${agent.name}'s workstation?`}
        description="The machine and every file in its home folder are deleted. The next task starts a fresh one. Threads, memory and routines are kept."
        action="Reset workstation"
        onConfirm={async () => {
          try {
            await wipeWorkstation(agent.id)
            toast.add({ type: "success", title: "Workstation reset" })
          } catch (error) {
            toast.add({
              type: "error",
              title: "Couldn't reset the workstation",
              description: error instanceof Error ? error.message : undefined,
            })
          }
          onMachineChange()
        }}
      />
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${agent.name}?`}
        description={<DeletionNotice agent={agent} machine={machine} />}
        action={agent.busy ? "Stop and delete" : "Delete agent"}
        onConfirm={async () => {
          const outcome = await deleteAgent(agent.id, { stopRunning: agent.busy })
          reportDeletion(outcome)
          router.refresh()
        }}
      />
    </div>
  )
}

export function AgentsView({ agents }: { agents: AgentOverview[] }) {
  const router = useRouter()
  const { openAgentDialog } = useWorkspace()
  const [machines, setMachines] = React.useState<Record<string, Machine>>({})
  const [refreshing, setRefreshing] = React.useState(false)
  const ids = agents.map((agent) => agent.id).join(",")

  const load = React.useCallback(async () => {
    const wanted = ids ? ids.split(",") : []
    const entries = await Promise.all(
      wanted.map(async (id): Promise<[string, Machine]> => {
        try {
          const result = await workstationStatus(id)
          return [id, result.ok ? result.status : { state: "error", error: result.error }]
        } catch (error) {
          return [
            id,
            { state: "error", error: error instanceof Error ? error.message : "Failed" },
          ]
        }
      })
    )
    return Object.fromEntries(entries)
  }, [ids])

  React.useEffect(() => {
    let live = true
    load().then((next) => live && setMachines(next))
    return () => {
      live = false
    }
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    router.refresh()
    setMachines(await load())
    setRefreshing(false)
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6 text-[13px] text-muted-foreground">
        You have no agents yet.
        <Button size="sm" onClick={() => openAgentDialog()}>
          <PlusIcon data-icon="inline-start" />
          Create your first agent
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => openAgentDialog()}>
          <PlusIcon data-icon="inline-start" />
          New agent
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={refreshing}
          onClick={refresh}
        >
          {refreshing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          Refresh
        </Button>
      </div>
      <div className="grid gap-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            machine={machines[agent.id] ?? { state: "loading" }}
            onMachineChange={() => void load().then(setMachines)}
          />
        ))}
      </div>
    </div>
  )
}
