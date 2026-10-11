"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { LogoMark, Wordmark } from "@/components/brand"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { useWorkspace } from "@/components/workspace/context"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

function Section({
  label,
  count,
  onAdd,
  addLabel,
  children,
}: {
  label: string
  count?: number
  onAdd?: () => void
  addLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-px px-2 pt-4">
      <div className="flex h-6 items-center gap-2 px-2">
        <h2 className="label-mono">{label}</h2>
        {count !== undefined && (
          <span className="font-mono text-[10px] text-faint tabular-nums">{count}</span>
        )}
        {onAdd && (
          <Tooltip>
            <TooltipTrigger
              onClick={onAdd}
              aria-label={addLabel}
              className="ml-auto grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { nav, status, openAgentDialog, openSquadDialog, openPalette } = useWorkspace()
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()

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
        <span className="ml-auto rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          v{status.version}
        </span>
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
                <Link
                  key={thread.id}
                  href={`${base}/${thread.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] transition-colors",
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
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {owner && "name" in owner ? owner.name.slice(0, 10) : ""}
                  </span>
                </Link>
              )
            })}
          </Section>
        )}
      </div>

      <div className="flex flex-col gap-px border-t p-2">
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
