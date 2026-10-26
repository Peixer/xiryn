"use client"

import * as React from "react"
import {
  AlarmClockIcon,
  BookOpenIcon,
  BrainIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  CreditCardIcon,
  EraserIcon,
  CopyIcon,
  FileTextIcon,
  FilePenIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  HardDriveIcon,
  Share2Icon,
  Trash2Icon,
  GlobeIcon,
  KeyboardIcon,
  KeyRoundIcon,
  LockIcon,
  RefreshCwIcon,
  MonitorUpIcon,
  MousePointer2Icon,
  MousePointerClickIcon,
  MoveIcon,
  ScrollIcon,
  SearchIcon,
  SquareTerminalIcon,
  XIcon,
  type LucideIcon,
  HandIcon,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ActionApprovalCard } from "@/components/thread/action-approval"
import { useTakeover } from "@/components/thread/takeover"
import { PaymentApprovalCard, SecretRequestCard } from "@/components/vault/request-cards"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { XirynMessage } from "@/lib/agent/tools"
import { cn } from "@/lib/utils"

export type ToolPart = Extract<XirynMessage["parts"][number], { type: `tool-${string}` }>

type Meta = {
  icon: LucideIcon
  label: string
  summary?: (input: Record<string, unknown>) => string
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

const META: Record<string, Meta> = {
  spawn_work_session: { icon: SquareTerminalIcon, label: "coding sessions" },
  list_work_sessions: { icon: SquareTerminalIcon, label: "list sessions" },
  get_work_session: { icon: SquareTerminalIcon, label: "session status" },
  cancel_work_session: { icon: SquareTerminalIcon, label: "cancel session" },
  shell: { icon: SquareTerminalIcon, label: "shell", summary: (i) => str(i.command) },
  fs_read: { icon: FileTextIcon, label: "read", summary: (i) => str(i.path) },
  fs_write: { icon: FilePenIcon, label: "write", summary: (i) => str(i.path) },
  fs_list: { icon: FolderTreeIcon, label: "ls", summary: (i) => str(i.path) || "." },
  screen_capture: { icon: CameraIcon, label: "look", summary: () => "screen" },
  screen_share: { icon: MonitorUpIcon, label: "share", summary: () => "screen" },
  pointer_click: {
    icon: MousePointerClickIcon,
    label: "click",
    summary: (i) => `${i.double ? "double " : ""}${i.button ?? "left"} @ ${i.x},${i.y}`,
  },
  pointer_move: {
    icon: MousePointer2Icon,
    label: "move",
    summary: (i) => `${i.x},${i.y}`,
  },
  pointer_drag: {
    icon: MoveIcon,
    label: "drag",
    summary: (i) => `${i.fromX},${i.fromY} → ${i.toX},${i.toY}`,
  },
  pointer_scroll: {
    icon: ScrollIcon,
    label: "scroll",
    summary: (i) => `${i.direction ?? ""} ×${i.amount ?? 3} @ ${i.x},${i.y}`,
  },
  key_type: {
    icon: KeyboardIcon,
    label: "type",
    summary: (i) => JSON.stringify(str(i.text)).slice(0, 80),
  },
  key_press: {
    icon: KeyboardIcon,
    label: "key",
    summary: (i) =>
      [...((i.modifiers as string[] | undefined) ?? []), str(i.key)]
        .filter(Boolean)
        .join("+"),
  },
  web_search: { icon: SearchIcon, label: "search", summary: (i) => str(i.query) },
  web_fetch: {
    icon: GlobeIcon,
    label: "fetch",
    summary: (i) => str(i.url).replace(/^https?:\/\/(www\.)?/, ""),
  },
  memory_search: { icon: SearchIcon, label: "recall", summary: (i) => str(i.query) },
  skill_list: {
    icon: BookOpenIcon,
    label: "skills",
    summary: () => "list playbooks",
  },
  skill_read: { icon: BookOpenIcon, label: "skill", summary: (i) => str(i.slug) },
  memory_write: { icon: BrainIcon, label: "remember", summary: (i) => str(i.note) },
  memory_forget: { icon: EraserIcon, label: "forget", summary: (i) => str(i.id) },
  routine_create: {
    icon: AlarmClockIcon,
    label: "schedule",
    summary: (i) => str(i.name),
  },
  routine_list: {
    icon: AlarmClockIcon,
    label: "routines",
    summary: () => "list scheduled",
  },
  routine_delete: {
    icon: AlarmClockIcon,
    label: "unschedule",
    summary: (i) => str(i.id),
  },
  request_self_update: {
    icon: RefreshCwIcon,
    label: "update",
    summary: (i) => str(i.action),
  },
  request_takeover: { icon: HandIcon, label: "hand over", summary: (i) => str(i.reason) },
  vault_list: { icon: LockIcon, label: "vault", summary: () => "list saved items" },
  vault_fill: {
    icon: KeyRoundIcon,
    label: "fill",
    summary: (i) =>
      i.terminal === true
        ? `secret into ${Array.isArray(i.command) ? str(i.command[0]) : "a program"}`
        : `${str(i.field).replace(/_/g, " ")} from the vault`,
  },
  request_payment_approval: {
    icon: CreditCardIcon,
    label: "pay?",
    summary: (i) => `${str(i.amount)} to ${str(i.merchant)}`,
  },
  request_secret: { icon: KeyRoundIcon, label: "ask", summary: (i) => str(i.reason) },
  drive_search: {
    icon: SearchIcon,
    label: "drive",
    summary: (i) => clipTool(i.query) || "search",
  },
  drive_list_folders: { icon: FolderTreeIcon, label: "folders", summary: () => "Drive" },
  drive_get: { icon: HardDriveIcon, label: "drive", summary: (i) => clipTool(i.id) },
  drive_read: { icon: FileTextIcon, label: "drive", summary: (i) => clipTool(i.id) },
  drive_list_permissions: {
    icon: Share2Icon,
    label: "access",
    summary: (i) => clipTool(i.id),
  },
  drive_create_folder: {
    icon: FolderPlusIcon,
    label: "folder",
    summary: (i) => clipTool(i.name),
  },
  drive_create_file: {
    icon: FilePenIcon,
    label: "upload",
    summary: (i) => clipTool(i.name),
  },
  drive_create_doc: {
    icon: FilePenIcon,
    label: "doc",
    summary: (i) => clipTool(i.name),
  },
  drive_update_file: {
    icon: FilePenIcon,
    label: "update",
    summary: (i) => clipTool(i.id),
  },
  drive_copy_file: { icon: CopyIcon, label: "copy", summary: (i) => clipTool(i.id) },
  drive_trash: { icon: Trash2Icon, label: "trash", summary: (i) => clipTool(i.id) },
  drive_share: { icon: Share2Icon, label: "share", summary: (i) => clipTool(i.id) },
}

function clipTool(value: unknown) {
  return str(value)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 80)
}

export function toolName(part: ToolPart) {
  return part.type.slice("tool-".length)
}

function Pre({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-80 overflow-auto rounded-md border bg-background/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90",
        className
      )}
    >
      {children}
    </pre>
  )
}

function Screenshot({
  image,
  mediaType,
  alt,
}: {
  image: string
  mediaType: string
  alt: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:${mediaType};base64,${image}`}
      alt={alt}
      className="w-full max-w-xl rounded-md border bg-black"
    />
  )
}

function Details({ part }: { part: ToolPart }) {
  const name = toolName(part)
  const input = (part.input ?? {}) as Record<string, unknown>
  const output =
    part.state === "output-available" ? (part.output as Record<string, unknown>) : null

  if (part.state === "output-error") {
    return (
      <div className="flex flex-col gap-2">
        {Object.keys(input).length > 0 && <Pre>{JSON.stringify(input, null, 2)}</Pre>}
        <Pre className="border-destructive/30 bg-destructive/5 text-destructive">
          {part.errorText}
        </Pre>
      </div>
    )
  }

  switch (name) {
    case "vault_fill": {
      if (!output) return null
      if (output.mode === "terminal") {
        return (
          <div className="flex flex-col gap-2">
            <Pre>
              <span className="text-rigel select-none">$ </span>
              {Array.isArray(input.command)
                ? (input.command as string[]).map((part) => str(part)).join(" ")
                : ""}
            </Pre>
            <Pre>
              {str(output.output) || (
                <span className="text-muted-foreground">(no output)</span>
              )}
              {"\n"}
              <span className={output.exitCode === 0 ? "text-ok" : "text-destructive"}>
                exit {String(output.exitCode)}
              </span>
            </Pre>
          </div>
        )
      }
      return (
        <p className="text-[13px]">
          {str(output.filled)} · {str(output.item)}
        </p>
      )
    }
    case "shell":
      return (
        <div className="flex flex-col gap-2">
          <Pre>
            <span className="text-rigel select-none">$ </span>
            {str(input.command)}
          </Pre>
          {output && (
            <Pre>
              {str(output.output) || (
                <span className="text-muted-foreground">(no output)</span>
              )}
              {"\n"}
              <span className={output.exitCode === 0 ? "text-ok" : "text-destructive"}>
                exit {String(output.exitCode)}
              </span>
            </Pre>
          )}
        </div>
      )
    case "fs_read":
      return output ? <Pre>{str(output.content)}</Pre> : null
    case "fs_write":
      return <Pre>{str(input.content)}</Pre>
    case "fs_list":
      return output ? (
        <Pre>
          {(output.entries as { name: string; dir: boolean; size: number }[]).map(
            (entry) => (
              <div key={entry.name} className="flex gap-3">
                <span className={entry.dir ? "text-rigel" : undefined}>
                  {entry.name}
                  {entry.dir ? "/" : ""}
                </span>
                {!entry.dir && (
                  <span className="text-muted-foreground">{entry.size}b</span>
                )}
              </div>
            )
          )}
        </Pre>
      ) : null
    case "screen_capture":
    case "screen_share":
      return output?.image ? (
        <Screenshot
          image={str(output.image)}
          mediaType={str(output.mediaType) || "image/jpeg"}
          alt="Workstation screen"
        />
      ) : (
        <p className="text-[12px] text-muted-foreground">Screenshot not kept.</p>
      )
    case "pointer_click":
    case "pointer_move":
    case "pointer_drag":
    case "pointer_scroll":
    case "key_type":
    case "key_press":
      return (
        <div className="flex flex-col gap-2">
          {name === "key_type" && <Pre>{str(input.text)}</Pre>}
          {output?.image ? (
            <Screenshot
              image={str(output.image)}
              mediaType={str(output.mediaType) || "image/jpeg"}
              alt="The screen just after this action"
            />
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Screenshot after this step not kept.
            </p>
          )}
        </div>
      )
    case "web_search":
      return output ? (
        <ol className="flex flex-col gap-2">
          {(output.results as { title: string; url: string; snippet: string }[]).map(
            (result) => (
              <li key={result.url} className="flex flex-col gap-0.5">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-medium text-rigel hover:underline"
                >
                  {result.title}
                </a>
                <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {result.url}
                </span>
                {result.snippet && (
                  <span className="line-clamp-2 text-[12px] text-muted-foreground">
                    {result.snippet}
                  </span>
                )}
              </li>
            )
          )}
        </ol>
      ) : null
    case "web_fetch":
      return output ? (
        <div className="flex flex-col gap-2">
          <a
            href={str(output.url)}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-rigel hover:underline"
          >
            {str(output.title) || str(output.url)}
          </a>
          <Pre>{str(output.markdown).slice(0, 4000)}</Pre>
        </div>
      ) : null
    case "memory_search": {
      const matches = (output?.matches ?? []) as {
        id: string
        scope: string
        age: string
        text: string
      }[]
      if (!output) return null
      if (matches.length === 0) {
        return <p className="text-[13px] text-muted-foreground">No matching notes.</p>
      }
      return (
        <ul className="flex flex-col gap-2">
          {matches.map((match) => (
            <li key={match.id} className="flex flex-col gap-0.5">
              <span className="font-mono text-[10.5px] text-faint">
                <span
                  className={match.scope === "shared" ? "text-betelgeuse" : "text-rigel"}
                >
                  {match.scope}
                </span>
                {" · "}
                {match.age}
                {" · "}
                {match.id}
              </span>
              <p className="text-[13px] leading-snug">{match.text}</p>
            </li>
          ))}
        </ul>
      )
    }
    case "skill_list": {
      const listed = Array.isArray(output?.skills)
        ? (output.skills as { name?: string; slug?: string }[])
        : []
      return output ? (
        <ul className="flex flex-col gap-1">
          {listed.map((skill) => (
            <li key={str(skill.slug)} className="text-[13px]">
              {str(skill.name)}{" "}
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {str(skill.slug)}
              </span>
            </li>
          ))}
          {listed.length === 0 && (
            <li className="text-[13px] text-muted-foreground">No skills saved.</li>
          )}
        </ul>
      ) : null
    }
    case "skill_read":
      return output ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{str(output.name)}</span>
          <Pre>{str(output.body).slice(0, 4000)}</Pre>
        </div>
      ) : null
    case "memory_write":
      return <p className="text-[13px]">{str(input.note)}</p>
    case "routine_create":
      return (
        <div className="flex flex-col gap-1.5 text-[13px]">
          {output && (
            <span className="font-mono text-[11px] text-rigel">
              {str(output.when)}
              {output.nextRun ? ` · next ${str(output.nextRun)}` : ""}
            </span>
          )}
          <p>{str(input.task)}</p>
          {output && (
            <a
              href="/routines"
              className="w-fit font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              manage in routines →
            </a>
          )}
        </div>
      )
    default:
      return (
        <div className="flex flex-col gap-2">
          <Pre>{JSON.stringify(input, null, 2)}</Pre>
          {output && <Pre>{JSON.stringify(output, null, 2)}</Pre>}
        </div>
      )
  }
}

function duration(part: ToolPart) {
  if (part.state !== "output-available") return null
  const ms = (part.output as { durationMs?: number } | undefined)?.durationMs
  if (typeof ms !== "number") return null
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// The agent paused and handed its desktop to the person
function TakeoverRequest({ part }: { part: ToolPart }) {
  const { available, active, start } = useTakeover()
  const reason = String((part.input as { reason?: string } | undefined)?.reason ?? "")
  return (
    <div className="my-1 flex flex-col gap-2.5 rounded-lg border border-betelgeuse/30 bg-betelgeuse-soft p-3.5">
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-betelgeuse">
        <HandIcon className="size-3.5" />
        needs you at the screen
      </span>
      <p className="text-[13.5px] leading-relaxed">{reason}</p>
      {available ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={start} disabled={active}>
            <HandIcon data-icon="inline-start" />
            {active ? "You have control" : "Take over"}
          </Button>
          <span className="text-[12px] text-muted-foreground">
            Do your part, then hand it back — it carries on from there.
          </span>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Take over from this agent&apos;s own thread (Screen tab), then reply here when
          you&apos;re done.
        </p>
      )}
    </div>
  )
}

export function ToolCall({
  part,
  live = true,
  awaiting = false,
}: {
  part: ToolPart
  live?: boolean
  // The latest thing in the thread: a request in it can still be answered
  awaiting?: boolean
}) {
  const name = toolName(part)
  const meta = META[name] ?? { icon: SquareTerminalIcon, label: name }
  const Icon = meta.icon
  const pending = part.state === "input-streaming" || part.state === "input-available"
  // A call still pending after its turn ended was cut off by a stop or a failure
  const running = pending && live
  const interrupted = pending && !live
  const failed = part.state === "output-error"
  const summary = meta.summary?.((part.input ?? {}) as Record<string, unknown>) ?? ""
  const time = duration(part)

  if (toolName(part) === "request_takeover" && part.state === "output-available") {
    return <TakeoverRequest part={part} />
  }
  if (name === "request_payment_approval" && part.state === "output-available") {
    const output = part.output as { approvalId: string }
    return <PaymentApprovalCard approvalId={output.approvalId} awaiting={awaiting} />
  }
  if (part.state === "output-available") {
    const output = part.output as { status?: string; approvalId?: string }
    if (output?.status === "needs-approval" && output.approvalId) {
      return <ActionApprovalCard approvalId={output.approvalId} awaiting={awaiting} />
    }
  }
  if (name === "request_secret" && part.state === "output-available") {
    const output = part.output as {
      kind: "login" | "card" | "upi" | "identity" | "code"
      reason: string
      site: string | null
    }
    return (
      <SecretRequestCard
        kind={output.kind}
        reason={output.reason}
        site={output.site}
        awaiting={awaiting}
      />
    )
  }

  // A shared screen is meant to be seen, so it is shown open
  if (name === "screen_share" && part.state === "output-available") {
    const output = part.output as { image: string | null; mediaType: string }
    return (
      <figure className="flex flex-col gap-1.5">
        {output.image && (
          <Screenshot
            image={output.image}
            mediaType={output.mediaType}
            alt="Shared screen"
          />
        )}
        <figcaption className="font-mono text-[10.5px] text-muted-foreground">
          shared screen
        </figcaption>
      </figure>
    )
  }

  return (
    <Collapsible className="group/tool">
      <CollapsibleTrigger
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left font-mono text-[12px] transition-colors hover:border-border hover:bg-accent/40",
          "data-panel-open:border-border data-panel-open:bg-accent/30"
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          {running ? (
            <Spinner className="size-3 text-rigel" />
          ) : interrupted ? (
            <CircleSlashIcon className="size-3.5 text-faint" />
          ) : failed ? (
            <XIcon className="size-3.5 text-destructive" />
          ) : (
            <CheckIcon className="size-3.5 text-ok" />
          )}
        </span>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("shrink-0", running && "shimmer-text")}>{meta.label}</span>
        <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-faint">
          {interrupted ? "interrupted" : time}
          <ChevronRightIcon className="size-3.5 transition-transform group-data-open/tool:rotate-90" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5 pb-1 pl-8">
        <Details part={part} />
      </CollapsibleContent>
    </Collapsible>
  )
}
