"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ActivityIcon,
  AlarmClockIcon,
  ArrowUpCircleIcon,
  BookOpenIcon,
  LayoutGridIcon,
  MailIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  SunIcon,
  Trash2Icon,
  BotIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { deleteThread } from "@/actions/threads"
import { checkForUpdates } from "@/actions/updates"
import { LogoMark, Wordmark } from "@/components/brand"
import { Confirm } from "@/components/confirm"
import { useFeedbackContext } from "@/components/feedback/feedback-prompt"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { useWorkspace } from "@/components/workspace/context"
import { Kbd } from "@/components/ui/kbd"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { feedbackMailto } from "@/lib/feedback"
import { REPOSITORY_URL, STARS_SHOWN_FROM, UPDATE_GUIDE_URL } from "@/lib/project"
import type { UpdateInfo } from "@/lib/updates"
import { cn } from "@/lib/utils"

// What the server last knew, then what GitHub says now: asked once each
// time the page loads, so a new push shows up on the next reload
function useUpdates(initial: UpdateInfo | null) {
  const [fetched, setFetched] = React.useState<UpdateInfo | null | undefined>()
  React.useEffect(() => {
    checkForUpdates()
      .then(setFetched)
      .catch(() => {})
  }, [])
  return fetched === undefined ? initial : fetched
}

// 1234 → 1.2k
function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n)
}

function Section({
  label,
  count,
  onAdd,
  addLabel,
  manageHref,
  onNavigate,
  children,
}: {
  label: string
  count?: number
  onAdd?: () => void
  addLabel?: string
  manageHref?: string
  onNavigate?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-px px-2 pt-4">
      <div className="flex h-6 items-center gap-2 px-2">
        <h2 className="label-mono">{label}</h2>
        {count !== undefined && (
          <span className="font-mono text-[10px] text-faint tabular-nums">{count}</span>
        )}
        {manageHref && (
          <Tooltip>
            <TooltipTrigger
              render={<Link href={manageHref} onClick={onNavigate} />}
              aria-label={`Manage ${label.toLowerCase()}`}
              className="ml-auto grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <SlidersHorizontalIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">{`Manage ${label.toLowerCase()}`}</TooltipContent>
          </Tooltip>
        )}
        {onAdd && (
          <Tooltip>
            <TooltipTrigger
              onClick={onAdd}
              aria-label={addLabel}
              className={cn(
                "grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                !manageHref && "ml-auto"
              )}
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">{addLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
    </section>
  )
}

function Item({
  href,
  active,
  icon,
  title,
  subtitle,
  busy,
  onNavigate,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle?: string | null
  busy?: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60"
      )}
    >
      {active && (
        <span className="absolute top-1.5 bottom-1.5 -left-2 w-[2px] rounded-full bg-rigel" />
      )}
      {icon}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] font-medium">{title}</span>
        {subtitle && (
          <span className="truncate font-mono text-[10.5px] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {busy && (
        <span
          title="Working"
          className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-rigel text-rigel"
        />
      )}
    </Link>
  )
}

// A page link in the sidebar's footer
function FooterLink({
  href,
  pathname,
  onNavigate,
  children,
}: {
  href: string
  pathname: string
  onNavigate?: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
        pathname === href
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {children}
    </Link>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { nav, status, openAgentDialog, openSquadDialog, openPalette } = useWorkspace()
  const pathname = usePathname()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const updates = useUpdates(status.updates)
  const feedback = useFeedbackContext()

  const recent = nav.threads.slice(0, 8)
  const ownerOf = (thread: (typeof nav.threads)[number]) =>
    thread.agentId
      ? nav.agents.find((agent) => agent.id === thread.agentId)
      : nav.squads.find((squad) => squad.id === thread.squadId)

  return (
    <aside className="flex h-full w-full flex-col bg-surface/50">
      <div className="hairline-b flex h-12 shrink-0 items-center gap-2 px-4">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2">
          <LogoMark className="size-[22px]" />
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          {updates?.stars != null && updates.stars >= STARS_SHOWN_FROM && (
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              title="Star Xiryn on GitHub"
              className="flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground transition-colors hover:border-betelgeuse/40 hover:text-betelgeuse"
            >
              <StarIcon className="size-2.5 fill-current" />
              {compact(updates.stars)}
            </a>
          )}
          {updates?.available ? (
            <a
              href={UPDATE_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              title={
                updates.behind
                  ? `${updates.behind} new commit${updates.behind === 1 ? "" : "s"} on GitHub — see how to update`
                  : `Xiryn ${updates.latestVersion} is out — see how to update`
              }
              className="flex items-center gap-1 rounded-sm border border-betelgeuse/40 bg-betelgeuse-soft px-1.5 py-px font-mono text-[10px] text-betelgeuse transition-colors hover:bg-betelgeuse/20"
            >
              <ArrowUpCircleIcon className="size-2.5" />
              update
            </a>
          ) : (
            <span className="rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              v{status.version}
            </span>
          )}
        </div>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background/60 px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <SearchIcon className="size-3.5" />
          Jump to…
          <Kbd className="ml-auto font-mono text-[10px]">⌘K</Kbd>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <Section
          label="Agents"
          count={nav.agents.length}
          onAdd={() => openAgentDialog()}
          addLabel="New agent"
          manageHref="/agents"
          onNavigate={onNavigate}
        >
          {nav.agents.length === 0 ? (
            <button
              type="button"
              onClick={() => openAgentDialog()}
              className="mx-0 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-input hover:text-foreground"
            >
              <PlusIcon className="size-3.5" />
              Create your first agent
            </button>
          ) : (
            nav.agents.map((agent) => (
              <Item
                key={agent.id}
                href={
                  agent.latestThreadId
                    ? `/a/${agent.id}/${agent.latestThreadId}`
                    : `/a/${agent.id}`
                }
                active={pathname.startsWith(`/a/${agent.id}`)}
                icon={<Glyph seed={agent.glyph} className="size-[26px]" />}
                title={agent.name}
                subtitle={agent.role}
                busy={agent.busy}
                onNavigate={onNavigate}
              />
            ))
          )}
        </Section>

        <Section
          label="Squads"
          count={nav.squads.length}
          onAdd={() => openSquadDialog()}
          addLabel="New squad"
        >
          {nav.squads.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-faint">
              {nav.agents.length < 2
                ? "Two or more agents can work as a squad."
                : "Group agents so they can hand work to each other."}
            </p>
          ) : (
            nav.squads.map((squad) => (
              <Item
                key={squad.id}
                href={
                  squad.latestThreadId
                    ? `/s/${squad.id}/${squad.latestThreadId}`
                    : `/s/${squad.id}`
                }
                active={pathname.startsWith(`/s/${squad.id}`)}
                icon={<SquadGlyph seeds={squad.glyphs} className="size-[26px]" />}
                title={squad.name}
                subtitle={`${squad.agentIds.length} agent${squad.agentIds.length === 1 ? "" : "s"}`}
                busy={squad.busy}
                onNavigate={onNavigate}
              />
            ))
          )}
        </Section>

        {recent.length > 0 && (
          <Section label="Recent threads">
            {recent.map((thread) => {
              const owner = ownerOf(thread)
              const base = thread.agentId
                ? `/a/${thread.agentId}`
                : `/s/${thread.squadId}`
              return (
                <div key={thread.id} className="group/thread relative">
                  <Link
                    href={`${base}/${thread.id}`}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 pr-7 text-[12.5px] transition-colors",
                      pathname.endsWith(thread.id)
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "size-1 shrink-0 rounded-full",
                        thread.busy
                          ? "animate-pulse-dot bg-rigel text-rigel"
                          : "bg-faint/60"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {thread.title ?? "New thread"}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-faint transition-opacity group-hover/thread:opacity-0">
                      {owner && "name" in owner ? owner.name.slice(0, 10) : ""}
                    </span>
                  </Link>
                  <Confirm
                    trigger={
                      <button
                        type="button"
                        aria-label={`Delete thread ${thread.title ?? "New thread"}`}
                        className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-faint opacity-0 transition-opacity group-hover/thread:opacity-100 hover:bg-accent hover:text-destructive focus-visible:opacity-100"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    }
                    title="Delete this thread?"
                    description={`"${thread.title ?? "New thread"}" and its messages are deleted. The agent, its memory and its workstation stay.`}
                    action="Delete thread"
                    onConfirm={async () => {
                      await deleteThread(thread.id)
                      toast.add({ type: "success", title: "Thread deleted" })
                      if (pathname.endsWith(thread.id)) router.push(base)
                    }}
                  />
                </div>
              )
            })}
          </Section>
        )}
      </div>

      <div className="flex flex-col gap-px border-t p-2">
        <FooterLink href="/agents" pathname={pathname} onNavigate={onNavigate}>
          <BotIcon className="size-4" />
          Agents
        </FooterLink>
        <FooterLink href="/templates" pathname={pathname} onNavigate={onNavigate}>
          <LayoutGridIcon className="size-4" />
          Templates
        </FooterLink>
        <FooterLink href="/routines" pathname={pathname} onNavigate={onNavigate}>
          <AlarmClockIcon className="size-4" />
          Routines
        </FooterLink>
        <FooterLink href="/skills" pathname={pathname} onNavigate={onNavigate}>
          <BookOpenIcon className="size-4" />
          Skills
        </FooterLink>
        <Link
          href="/usage"
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
            pathname === "/usage"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          )}
        >
          <ActivityIcon className="size-4" />
          Usage
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            onClick={onNavigate}
            className={cn(
              "flex h-8 flex-1 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
              pathname === "/settings"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <SettingsIcon className="size-4" />
            Settings
            {!status.ready && (
              <span
                title="Setup incomplete"
                className="ml-auto size-1.5 rounded-full bg-betelgeuse"
              />
            )}
          </Link>
          <Tooltip>
            <TooltipTrigger
              render={<a href={feedbackMailto(feedback)} />}
              aria-label="Send feedback"
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <MailIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="top">Send feedback</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <SunIcon className="hidden size-4 dark:block" />
              <MoonIcon className="size-4 dark:hidden" />
            </TooltipTrigger>
            <TooltipContent side="top">Toggle theme</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  )
}
