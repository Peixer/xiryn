"use client"

import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import {
  BrainIcon,
  ChevronDownIcon,
  CpuIcon,
  MessageSquarePlusIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { createThread, deleteThread, renameThread } from "@/actions/threads"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { ModelSpecLabel } from "@/components/model-picker"
import { Composer } from "@/components/thread/composer"
import { Transcript, type AgentLite } from "@/components/thread/transcript"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Machine } from "@/components/workbench/machine"
import { MemoryPanel } from "@/components/workbench/memory"
import { Screen } from "@/components/workbench/screen"
import { useWorkspace } from "@/components/workspace/context"
import type { OrynMessage } from "@/lib/agent/tools"
import { cn } from "@/lib/utils"

export type ThreadSummary = { id: string; title: string | null; activeAt: string }

export type ThreadViewProps = {
  threadId: string
  title: string | null
  kind: "agent" | "squad"
  owner: { id: string; name: string; subtitle: string; glyphs: string[] }
  members: AgentLite[]
  threads: ThreadSummary[]
  initialMessages: OrynMessage[]
  workbenchOpen: boolean
}

function errorText(error: Error) {
  try {
    const parsed = JSON.parse(error.message)
    if (typeof parsed?.error === "string") return parsed.error
  } catch {}
  return error.message || "Something went wrong."
}

/* ─────────────────────────── workbench ─────────────────────────── */

const TABS = [
  { id: "screen", label: "Screen", icon: MonitorIcon },
  { id: "memory", label: "Memory", icon: BrainIcon },
  { id: "machine", label: "Machine", icon: CpuIcon },
] as const

function Workbench({
  agentId,
  refreshKey,
  workstationEnabled,
}: {
  agentId: string
  refreshKey: number
  workstationEnabled: boolean
}) {
  const [tab, setTab] = React.useState<(typeof TABS)[number]["id"]>("screen")
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface/40">
      <div className="hairline-b flex h-10 shrink-0 items-stretch gap-1 px-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "relative flex items-center gap-1.5 px-2 font-mono text-[11px] tracking-wide uppercase transition-colors",
              tab === id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {tab === id && (
              <span className="absolute inset-x-1 -bottom-px h-px bg-rigel" />
            )}
          </button>
        ))}
      </div>
      {/* Panels stay mounted so the desktop stream survives tab switches */}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", tab !== "screen" && "hidden")}>
        <Screen agentId={agentId} enabled={workstationEnabled} />
      </div>
      <div className={cn("min-h-0 flex-1", tab !== "memory" && "hidden")}>
        <MemoryPanel agentId={agentId} refreshKey={refreshKey} />
      </div>
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto", tab !== "machine" && "hidden")}
      >
        <Machine agentId={agentId} refreshKey={refreshKey} />
      </div>
    </div>
  )
}

/* ──────────────────────────── header ───────────────────────────── */

function ThreadHeader({
  props,
  workbenchOpen,
  onToggleWorkbench,
}: {
  props: ThreadViewProps
  workbenchOpen: boolean
  onToggleWorkbench?: () => void
}) {
  const router = useRouter()
  const { nav, status, openAgentDialog, openSquadDialog } = useWorkspace()
  const { threadId, kind, owner, threads, title } = props
  const base = kind === "agent" ? `/a/${owner.id}` : `/s/${owner.id}`

  const configure = () => {
    if (kind === "agent") {
      const agent = nav.agents.find((a) => a.id === owner.id)
      if (agent) openAgentDialog({ agent })
    } else {
      const squad = nav.squads.find((s) => s.id === owner.id)
      if (squad) openSquadDialog({ squad })
    }
  }

  const newThread = async () => {
    const id = await createThread(
      kind === "agent" ? { agentId: owner.id } : { squadId: owner.id }
    )
    router.push(`${base}/${id}`)
  }

  const agentModel =
    kind === "agent" ? (props.members[0]?.model ?? status.defaultModel) : null

  return (
    <header className="hairline-b flex h-12 shrink-0 items-center gap-3 px-4">
      <button
        type="button"
        onClick={configure}
        className="flex min-w-0 items-center gap-2.5 rounded-md py-1 pr-2 text-left hover:bg-accent/50"
      >
        {kind === "agent" ? (
          <Glyph seed={owner.glyphs[0]} className="size-7" />
        ) : (
          <SquadGlyph seeds={owner.glyphs} className="size-7" />
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13.5px] font-semibold">{owner.name}</span>
          <span className="truncate font-mono text-[10.5px] text-muted-foreground">
            {owner.subtitle}
          </span>
        </span>
      </button>

      <span className="hidden h-5 w-px bg-border sm:block" />

      <DropdownMenu>
        <DropdownMenuTrigger className="hidden min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground sm:flex">
          <span className="max-w-72 truncate">{title ?? "New thread"}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuItem onClick={newThread}>
            <MessageSquarePlusIcon />
            New thread
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel className="label-mono">Threads</DropdownMenuLabel>
            {threads.map((thread) => (
              <DropdownMenuItem
                key={thread.id}
                onClick={() => router.push(`${base}/${thread.id}`)}
                className={cn(thread.id === threadId && "bg-accent")}
              >
                <span className="min-w-0 flex-1 truncate">
                  {thread.title ?? "New thread"}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {formatDistanceToNowStrict(new Date(thread.activeAt))}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-1">
        {agentModel && (
          <span className="mr-1 hidden rounded-md border px-2 py-0.5 lg:inline-flex">
            <ModelSpecLabel spec={agentModel} className="text-[11px]" />
          </span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="New thread"
                onClick={newThread}
              />
            }
          >
            <MessageSquarePlusIcon />
          </TooltipTrigger>
          <TooltipContent>New thread</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Configure"
                onClick={configure}
              />
            }
          >
            <SlidersHorizontalIcon />
          </TooltipTrigger>
          <TooltipContent>Configure {kind}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-sm" variant="ghost" aria-label="Thread options" />}
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={async () => {
                const next = window.prompt("Rename thread", title ?? "")
                if (next?.trim()) {
                  await renameThread(threadId, next)
                  router.refresh()
                }
              }}
            >
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Delete this thread and its messages?")) return
                await deleteThread(threadId)
                toast.add({ type: "success", title: "Thread deleted" })
                router.push(base)
              }}
            >
              <Trash2Icon />
              Delete thread
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onToggleWorkbench && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant={workbenchOpen ? "secondary" : "ghost"}
                  aria-label="Toggle workbench"
                  aria-pressed={workbenchOpen}
                  onClick={onToggleWorkbench}
                />
              }
            >
              {workbenchOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            </TooltipTrigger>
            <TooltipContent>Workbench · screen, memory, machine</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  )
}

/* ─────────────────────────── empty state ───────────────────────── */

function EmptyThread({
  props,
  onPick,
}: {
  props: ThreadViewProps
  onPick: (text: string) => void
}) {
  const { status } = useWorkspace()
  const suggestions = [
    status.workstation &&
      "Set up a Python project on your workstation, write a small script and run it.",
    status.web &&
      "Research the three most important developments in your field this month, with sources.",
    status.workstation &&
      "Open a browser on your desktop, go to news.ycombinator.com and show me the screen.",
    "Remember that I prefer short answers with code examples.",
    props.kind === "squad" &&
      "Plan a small project and have each of you take the part that fits your role.",
  ].filter((value): value is string => !!value)

  return (
    <div className="flex flex-col items-center gap-6 pt-[8vh] text-center">
      <div className="relative">
        <div className="absolute -inset-10 rounded-full bg-rigel/10 blur-2xl" />
        {props.kind === "agent" ? (
          <Glyph seed={props.owner.glyphs[0]} className="relative size-16" />
        ) : (
          <SquadGlyph seeds={props.owner.glyphs} className="relative size-16" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{props.owner.name}</h2>
        <p className="font-mono text-[12px] text-muted-foreground">
          {props.owner.subtitle}
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {suggestions.slice(0, 4).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-lg border bg-surface/50 px-3 py-2.5 text-left text-[12.5px] leading-snug text-muted-foreground transition-colors hover:border-input hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ──────────────────────────── thread ───────────────────────────── */

export function ThreadView(props: ThreadViewProps) {
  const { threadId, kind, members, initialMessages } = props
  const router = useRouter()
  const { status } = useWorkspace()
  const [addresseeId, setAddresseeId] = React.useState(members[0]?.id)
  const [refreshKey, setRefreshKey] = React.useState(0)
  // Remembered in a cookie so the server renders the right layout first time
  const [workbenchOpen, setWorkbenchOpen] = React.useState(props.workbenchOpen)

  const toggleWorkbench = () => {
    const next = !workbenchOpen
    document.cookie = `oryn_workbench=${next ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`
    setWorkbenchOpen(next)
  }

  const api = `/api/threads/${threadId}/turn`
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<OrynMessage>({
        api,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { message: messages[messages.length - 1], agentId: body?.agentId },
        }),
        prepareReconnectToStreamRequest: () => ({ api }),
      }),
    [api]
  )

  const {
    messages,
    sendMessage,
    status: chatStatus,
    stop,
    error,
    clearError,
  } = useChat<OrynMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    resume: true,
    onFinish: () => {
      // The server settles the run (ledger, preview) just after the last chunk
      setTimeout(() => {
        setRefreshKey((key) => key + 1)
        router.refresh()
      }, 700)
    },
  })

  const busy = chatStatus === "submitted" || chatStatus === "streaming"
  const addressee = members.find((member) => member.id === addresseeId) ?? members[0]
  const modelSpec = addressee?.model ?? status.defaultModel

  const send = (text: string) => {
    clearError()
    sendMessage(
      { text, metadata: kind === "squad" ? { agentId: addressee.id } : undefined },
      { body: { agentId: addressee?.id } }
    )
    // Let the sidebar pick up the new title and the busy indicator
    setTimeout(() => router.refresh(), 400)
  }

  const halt = () => {
    stop()
    fetch(api, { method: "DELETE" }).finally(() => router.refresh())
  }

  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      <Transcript
        messages={messages}
        members={members}
        status={chatStatus}
        isSquad={kind === "squad"}
        empty={<EmptyThread props={props} onPick={send} />}
        footer={
          error ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium text-destructive">The turn failed</span>
                <span className="break-words text-muted-foreground">
                  {errorText(error)}
                </span>
                {!status.ready && (
                  <Link href="/settings#providers" className="text-rigel hover:underline">
                    Configure a model provider →
                  </Link>
                )}
              </div>
            </div>
          ) : null
        }
      />
      <Composer
        draftKey={threadId}
        placeholder={
          kind === "squad"
            ? `Message ${addressee?.name ?? "the squad"}…`
            : `Message ${props.owner.name}…`
        }
        busy={busy}
        onSend={send}
        onStop={halt}
        members={kind === "squad" ? members : undefined}
        addressee={kind === "squad" ? addressee : undefined}
        onAddresseeChange={setAddresseeId}
        modelSpec={modelSpec}
      />
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        props={props}
        workbenchOpen={workbenchOpen}
        onToggleWorkbench={kind === "agent" ? toggleWorkbench : undefined}
      />
      {kind === "agent" && workbenchOpen ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="chat" minSize="35%">
            {chat}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="workbench" defaultSize="38%" minSize="24%" maxSize="60%">
            <Workbench
              agentId={members[0].id}
              refreshKey={refreshKey}
              workstationEnabled={status.workstation}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 flex-1">{chat}</div>
      )}
    </div>
  )
}
