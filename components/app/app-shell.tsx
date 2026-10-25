"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import {
  AlarmClockIcon,
  BotIcon,
  ChevronRightIcon,
  MessageCircleIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { createThread } from "@/actions/threads"
import { hapticTap } from "@/components/app/haptic"
import { InstallGuide, replayInstallGuide } from "@/components/app/install-guide"
import { OfflineThread } from "@/components/app/offline-thread"
import { useOffline } from "@/components/app/offline-provider"
import { Sheet } from "@/components/app/sheet"
import { LogoMark, Wordmark } from "@/components/brand"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { useNotifications } from "@/components/workspace/notifier"
import { useWorkspace } from "@/components/workspace/context"
import { subscribeInstalledPush } from "@/components/app/push-client"
import { rememberThreadList } from "@/lib/pwa/local-db"
import {
  isIosSafariUserAgent,
  isThreadPath,
  PHONE_MAX_WIDTH,
  shellCoversPage,
} from "@/lib/pwa/shell"
import type { AgentOverview, RoutineView } from "@/queries/workspace"
import { cn } from "@/lib/utils"
import { SelfUpdatePanel } from "@/components/settings/self-update-panel"
import { toast } from "@/components/ui/toast"

function Presence({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-mono text-[11px]",
        online ? "bg-ok/12 text-ok" : "bg-betelgeuse/15 text-betelgeuse"
      )}
    >
      <span className={cn("size-1.5 rounded-full", online ? "bg-ok" : "bg-betelgeuse")} />
      {online ? "Online" : "Offline"}
    </span>
  )
}

function when(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return formatDistanceToNowStrict(date, { addSuffix: true })
}

export function AppShell({
  agents,
  routines,
}: {
  agents: AgentOverview[]
  routines: RoutineView[]
}) {
  const pathname = usePathname()
  const { online, outbox, storedThreads, forgetDevice } = useOffline()
  const { nav } = useWorkspace()
  const [detail, setDetail] = React.useState(false)
  const [offlineId, setOfflineId] = React.useState<string | null>(null)
  const [guideKey, setGuideKey] = React.useState(0)
  const [updateOpen, setUpdateOpen] = React.useState(false)
  const [updateAvailable, setUpdateAvailable] = React.useState(false)

  React.useEffect(() => {
    // A new route starts on the designed screen, not the desktop page under it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(false)
    setOfflineId(null)
    setUpdateOpen(false)
  }, [pathname])

  React.useEffect(() => {
    let stop = false
    const tick = () => {
      void fetch("/api/self-update/status")
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { updateAvailable?: boolean } | null) => {
          if (!stop && body) setUpdateAvailable(Boolean(body.updateAvailable))
        })
        .catch(() => {})
    }
    tick()
    const timer = window.setInterval(tick, 60_000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  React.useEffect(() => {
    if (!online) return
    const rows = nav.threads.flatMap((thread) => {
      const agent = nav.agents.find((item) => item.id === thread.agentId)
      const squad = nav.squads.find((item) => item.id === thread.squadId)
      const href = agent
        ? `/a/${agent.id}/${thread.id}`
        : squad
          ? `/s/${squad.id}/${thread.id}`
          : ""
      if (!href) return []
      return [
        {
          threadId: thread.id,
          title: thread.title,
          href,
          agentName: agent?.name ?? squad?.name ?? "Conversation",
          glyph: agent?.glyph ?? squad?.glyphs[0] ?? "xiryn",
          preview: thread.preview ?? "",
          activeAt: thread.activeAt,
        },
      ]
    })
    void rememberThreadList(rows)
  }, [nav, online])

  const thread = isThreadPath(pathname)
  const list =
    !detail &&
    !thread &&
    (pathname === "/" ||
      pathname === "/agents" ||
      pathname === "/routines" ||
      pathname === "/settings")
  const pending = outbox.filter(
    (item) => item.state === "queued" || item.state === "failed"
  ).length

  React.useEffect(() => {
    const page = document.querySelector(".xiryn-page")
    if (!(page instanceof HTMLElement)) return
    const query = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`)
    const apply = () => {
      const covered = shellCoversPage({
        phone: query.matches,
        list,
        offline: Boolean(offlineId),
      })
      if (covered) page.setAttribute("inert", "")
      else page.removeAttribute("inert")
    }
    apply()
    query.addEventListener("change", apply)
    return () => {
      query.removeEventListener("change", apply)
      page.removeAttribute("inert")
    }
  }, [list, offlineId])

  const tabs = [
    { href: "/", label: "Chat", icon: MessageCircleIcon, on: pathname === "/" || thread },
    { href: "/agents", label: "Agents", icon: BotIcon, on: pathname === "/agents" },
    {
      href: "/routines",
      label: "Routines",
      icon: AlarmClockIcon,
      on: pathname === "/routines",
    },
    {
      href: "/settings",
      label: "Settings",
      icon: SettingsIcon,
      on: pathname === "/settings",
    },
  ]

  return (
    <div className="xiryn-app pointer-events-none fixed inset-0 z-30 flex-col">
      {list && pathname === "/" && (
        <ChatHome
          online={online}
          pending={pending}
          onOffline={(id) => setOfflineId(id)}
        />
      )}
      {list && pathname === "/agents" && (
        <AgentsHome agents={agents} online={online} onManage={() => setDetail(true)} />
      )}
      {list && pathname === "/routines" && (
        <RoutinesHome
          routines={routines}
          agents={nav.agents}
          online={online}
          onManage={() => setDetail(true)}
          onOffline={(id) => setOfflineId(id)}
        />
      )}
      {list && pathname === "/settings" && !updateOpen && (
        <DeviceSettings
          online={online}
          stored={storedThreads.length}
          pending={pending}
          updateAvailable={updateAvailable}
          onUpdate={() => setUpdateOpen(true)}
          onWorkspace={() => setDetail(true)}
          onForget={() => void forgetDevice()}
          onGuide={() => {
            replayInstallGuide()
            setGuideKey((key) => key + 1)
          }}
        />
      )}
      {list && pathname === "/settings" && updateOpen && (
        <UpdateVersion onBack={() => setUpdateOpen(false)} />
      )}
      {offlineId && (
        <OfflineThread threadId={offlineId} onClose={() => setOfflineId(null)} />
      )}
      {detail && (
        <button
          type="button"
          onClick={() => setDetail(false)}
          className="pointer-events-auto absolute top-[max(0.5rem,env(safe-area-inset-top))] right-3 z-40 rounded-full bg-foreground px-3.5 py-2 text-[13px] font-medium text-background"
        >
          Done
        </button>
      )}
      {!thread && !offlineId && (
        <div className="pointer-events-none mt-auto flex flex-col">
          <InstallGuide key={guideKey} />
          <nav className="xiryn-tabbar pointer-events-auto grid grid-cols-4 border-t bg-background/92 px-1 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={tab.on ? "page" : undefined}
                  onClick={() => hapticTap()}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium",
                    tab.on ? "text-rigel" : "text-muted-foreground"
                  )}
                >
                  <Icon className="size-6" strokeWidth={tab.on ? 2.4 : 1.8} />
                  {tab.label}
                  {tab.href === "/settings" && updateAvailable && (
                    <span className="absolute top-1 right-[calc(50%-18px)] size-2 rounded-full bg-betelgeuse" />
                  )}
                  {tab.href === "/" && pending > 0 && (
                    <span className="absolute top-1 right-[calc(50%-22px)] grid min-w-4 place-items-center rounded-full bg-betelgeuse px-1 text-[10px] text-background">
                      {pending}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </div>
  )
}

function ChatHome({
  online,
  pending,
  onOffline,
}: {
  online: boolean
  pending: number
  onOffline: (threadId: string) => void
}) {
  const { nav, openAgentDialog } = useWorkspace()
  const { storedThreads } = useOffline()
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [picking, setPicking] = React.useState(false)
  const [distance, setDistance] = React.useState(0)
  const pull = React.useRef({ y: 0, on: false, distance: 0 })

  const rows = React.useMemo(() => {
    const fromNav = nav.threads.flatMap((thread) => {
      const agent = nav.agents.find((item) => item.id === thread.agentId)
      const squad = nav.squads.find((item) => item.id === thread.squadId)
      const href = agent
        ? `/a/${agent.id}/${thread.id}`
        : squad
          ? `/s/${squad.id}/${thread.id}`
          : ""
      if (!href) return []
      return [
        {
          id: thread.id,
          title: thread.title ?? "New thread",
          preview: thread.preview ?? "",
          activeAt: thread.activeAt,
          busy: online && thread.busy,
          name: agent?.name ?? squad?.name ?? "Conversation",
          glyph: agent?.glyph,
          glyphs: squad?.glyphs,
          href,
        },
      ]
    })
    if (online) return fromNav
    const seen = new Set(fromNav.map((row) => row.id))
    const extra = storedThreads
      .filter((thread) => !seen.has(thread.threadId))
      .map((thread) => ({
        id: thread.threadId,
        title: thread.title ?? "Saved conversation",
        preview: thread.preview,
        activeAt: thread.activeAt,
        busy: false,
        name: thread.agentName,
        glyph: thread.glyph,
        glyphs: undefined as string[] | undefined,
        href: thread.href,
      }))
    return [...fromNav, ...extra].sort((a, b) => b.activeAt.localeCompare(a.activeAt))
  }, [nav, online, storedThreads])

  const filtered = rows.filter((row) => {
    const hay = `${row.name} ${row.title} ${row.preview}`.toLowerCase()
    return hay.includes(query.trim().toLowerCase())
  })

  return (
    <div className="pointer-events-auto relative flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <LogoMark className="size-8" />
        <Wordmark className="text-[18px]" />
        <span className="ml-auto">
          <Presence online={online} />
        </span>
      </header>
      <div className="px-5 pb-3">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Chats</h1>
        {pending > 0 && (
          <p className="mt-1 text-[13px] text-betelgeuse">{pending} waiting to send</p>
        )}
        <label className="mt-3 flex h-12 items-center gap-2 rounded-full bg-elevated px-4">
          <SearchIcon className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-full w-full bg-transparent text-base outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-24"
        onTouchStart={(event) => {
          const el = event.currentTarget
          if (el.scrollTop > 0) return
          pull.current = { y: event.touches[0]?.clientY ?? 0, on: true, distance: 0 }
        }}
        onTouchMove={(event) => {
          if (!pull.current.on) return
          const dy = (event.touches[0]?.clientY ?? 0) - pull.current.y
          const next = dy > 0 ? Math.min(dy * 0.45, 72) : 0
          pull.current.distance = next
          setDistance(next)
        }}
        onTouchEnd={() => {
          if (pull.current.distance > 56) router.refresh()
          pull.current.on = false
          pull.current.distance = 0
          setDistance(0)
        }}
      >
        <div
          style={{ height: distance }}
          className="grid place-items-center overflow-hidden text-[12px] text-muted-foreground"
        >
          {distance > 56 ? "Release to refresh" : distance > 8 ? "Pull to refresh" : ""}
        </div>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <LogoMark className="size-14" />
            <p className="text-[17px] font-semibold">No conversations yet</p>
            <p className="max-w-xs text-[14px] leading-relaxed text-muted-foreground">
              Pick an agent and the thread opens full screen. Your messages stay on this
              device after you&apos;ve read them.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((row) => {
              const body = (
                <>
                  {row.glyphs ? (
                    <SquadGlyph seeds={row.glyphs} className="size-12 shrink-0" />
                  ) : (
                    <Glyph
                      seed={row.glyph ?? row.name}
                      className="size-12 shrink-0 rounded-2xl"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[16px] font-semibold">
                        {row.name}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
                        {when(row.activeAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13.5px] text-muted-foreground">
                      {row.busy ? "Working" : row.preview || row.title}
                    </span>
                  </span>
                </>
              )
              const className =
                "flex min-h-[76px] items-center gap-3 rounded-2xl px-2 active:bg-accent"
              if (!online) {
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={cn(className, "w-full text-left")}
                      onClick={() => {
                        hapticTap()
                        onOffline(row.id)
                      }}
                    >
                      {body}
                    </button>
                  </li>
                )
              }
              return (
                <li key={row.id}>
                  <Link href={row.href} className={className} onClick={() => hapticTap()}>
                    {body}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <button
        type="button"
        aria-label="New chat"
        onClick={() => {
          hapticTap()
          setPicking(true)
        }}
        className="absolute right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] grid size-14 place-items-center rounded-full bg-foreground text-background shadow-lg active:scale-95"
      >
        <PlusIcon className="size-6" />
      </button>
      <Sheet open={picking} title="New chat" onClose={() => setPicking(false)}>
        {!online && (
          <p className="mb-3 text-[14px] text-muted-foreground">
            Starting a thread needs a connection. Saved chats above still open.
          </p>
        )}
        <ul className="flex flex-col">
          {nav.agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                disabled={!online}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 text-left active:bg-accent disabled:opacity-40"
                onClick={async () => {
                  try {
                    const id = await createThread({ agentId: agent.id })
                    setPicking(false)
                    router.push(`/a/${agent.id}/${id}`)
                  } catch (error) {
                    toast.add({
                      type: "error",
                      title:
                        error instanceof Error ? error.message : "Couldn't start a chat.",
                    })
                  }
                }}
              >
                <Glyph seed={agent.glyph} className="size-10 rounded-xl" />
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-medium">
                    {agent.name}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {agent.role}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl border text-[15px] font-medium"
          onClick={() => {
            setPicking(false)
            openAgentDialog()
          }}
        >
          New agent
        </button>
      </Sheet>
    </div>
  )
}

function AgentsHome({
  agents,
  online,
  onManage,
}: {
  agents: AgentOverview[]
  online: boolean
  onManage: () => void
}) {
  const router = useRouter()
  const { openAgentDialog } = useWorkspace()
  return (
    <div className="pointer-events-auto relative flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Agents</h1>
        <button
          type="button"
          aria-label="New agent"
          onClick={() => openAgentDialog()}
          className="ml-auto grid size-11 place-items-center rounded-full bg-elevated"
        >
          <PlusIcon className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {agents.length === 0 ? (
          <p className="px-3 py-10 text-[15px] text-muted-foreground">
            No agents yet. Create one and it shows up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => {
                    hapticTap()
                    router.push(`/a/${agent.id}`)
                  }}
                  className="flex min-h-[76px] w-full items-center gap-3 rounded-2xl px-2 text-left active:bg-accent disabled:opacity-50"
                >
                  <Glyph seed={agent.glyph} className="size-12 rounded-2xl" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[16px] font-semibold">
                        {agent.name}
                      </span>
                      {online && agent.busy && (
                        <span className="font-mono text-[11px] text-rigel">Working</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[13.5px] text-muted-foreground">
                      {agent.role}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onManage}
          className="mx-2 mt-3 flex min-h-12 w-[calc(100%-1rem)] items-center justify-between rounded-2xl bg-elevated px-4 text-[15px]"
        >
          Import, export, delete
          <ChevronRightIcon className="size-4 text-faint" />
        </button>
      </div>
    </div>
  )
}

function RoutinesHome({
  routines,
  agents,
  online,
  onManage,
  onOffline,
}: {
  routines: RoutineView[]
  agents: { id: string; name: string; glyph: string }[]
  online: boolean
  onManage: () => void
  onOffline: (threadId: string) => void
}) {
  return (
    <div className="pointer-events-auto relative flex min-h-0 flex-1 flex-col bg-background">
      <header className="px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Routines</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Work your agents do on a schedule. Nothing runs while this device is offline.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {routines.length === 0 ? (
          <p className="px-3 py-6 text-[15px] text-muted-foreground">No routines yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {routines.map((routine) => {
              const agent = agents.find((item) => item.id === routine.agentId)
              const threadId = routine.href?.split("/").filter(Boolean).at(-1)
              const open = online ? routine.href : null
              const inner = (
                <>
                  <Glyph
                    seed={agent?.glyph ?? routine.name}
                    className="size-11 rounded-xl"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[16px] font-semibold">
                        {routine.name}
                      </span>
                      <span
                        className={cn(
                          "ml-auto shrink-0 font-mono text-[11px]",
                          routine.enabled ? "text-ok" : "text-faint"
                        )}
                      >
                        {routine.lastStatus === "running" && online
                          ? "Running"
                          : routine.enabled
                            ? "On"
                            : "Off"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                      {routine.when}
                      {agent ? ` · ${agent.name}` : ""}
                    </span>
                  </span>
                </>
              )
              return (
                <li key={routine.id}>
                  {open ? (
                    <Link
                      href={open}
                      onClick={() => hapticTap()}
                      className="flex min-h-[72px] items-center gap-3 rounded-2xl bg-elevated/70 px-3 active:bg-accent"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => threadId && onOffline(threadId)}
                      className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl bg-elevated/70 px-3 text-left active:bg-accent"
                    >
                      {inner}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <button
          type="button"
          onClick={onManage}
          className="mx-2 mt-3 flex min-h-12 w-[calc(100%-1rem)] items-center justify-between rounded-2xl bg-elevated px-4 text-[15px]"
        >
          Edit schedules
          <ChevronRightIcon className="size-4 text-faint" />
        </button>
      </div>
    </div>
  )
}

function UpdateVersion({ onBack }: { onBack: () => void }) {
  return (
    <div className="pointer-events-auto relative flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-full px-3 text-[15px] font-medium text-rigel"
        >
          Settings
        </button>
        <h1 className="text-[20px] font-semibold tracking-[-0.03em]">Update version</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <SelfUpdatePanel layout="phone" />
      </div>
    </div>
  )
}

function DeviceSettings({
  online,
  stored,
  pending,
  updateAvailable,
  onUpdate,
  onWorkspace,
  onForget,
  onGuide,
}: {
  online: boolean
  stored: number
  pending: number
  updateAvailable: boolean
  onUpdate: () => void
  onWorkspace: () => void
  onForget: () => void
  onGuide: () => void
}) {
  const { theme, setTheme } = useTheme()
  const notifications = useNotifications()
  const [push, setPush] = React.useState<string>("")
  const [ios, setIos] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIos(isIosSafariUserAgent(navigator.userAgent))
  }, [])

  return (
    <div className="pointer-events-auto relative flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Settings</h1>
        <span className="ml-auto">
          <Presence online={online} />
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-6">
        <section className="flex flex-col gap-2">
          <h2 className="label-mono">Version</h2>
          <button
            type="button"
            onClick={onUpdate}
            className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-elevated px-4 text-left"
          >
            <span>
              <span className="block text-[16px] font-medium">Update version</span>
              <span className="block text-[13px] text-muted-foreground">
                Build, switch, or roll back
              </span>
            </span>
            <span className="flex items-center gap-2">
              {updateAvailable && (
                <span className="rounded-full bg-betelgeuse px-2 py-0.5 text-[11px] font-medium text-background">
                  New
                </span>
              )}
              <ChevronRightIcon className="size-4 text-faint" />
            </span>
          </button>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="label-mono">Appearance</h2>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["dark", "Dark", MoonIcon],
                ["light", "Light", SunIcon],
                ["system", "System", SettingsIcon],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl border text-[13px]",
                  theme === id
                    ? "border-rigel bg-rigel/10 text-foreground"
                    : "bg-elevated text-muted-foreground"
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="label-mono">Notifications</h2>
          <button
            type="button"
            onClick={() => {
              notifications.toggle()
              void subscribeInstalledPush()
                .then(setPush)
                .catch(() => setPush("failed"))
            }}
            className="flex min-h-14 items-center justify-between rounded-2xl bg-elevated px-4 text-left"
          >
            <span>
              <span className="block text-[16px] font-medium">Alerts</span>
              <span className="block text-[13px] text-muted-foreground">
                {notifications.enabled ? "On" : "Off"}
                {notifications.permission === "unsupported"
                  ? " · not supported here"
                  : ""}
              </span>
            </span>
            <span
              className={cn(
                "h-7 w-12 rounded-full p-0.5 transition-colors",
                notifications.enabled ? "bg-rigel" : "bg-foreground/15"
              )}
            >
              <span
                className={cn(
                  "block size-6 rounded-full bg-background transition-transform",
                  notifications.enabled && "translate-x-5"
                )}
              />
            </span>
          </button>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {push === "unconfigured"
              ? "Web Push needs VAPID keys on the server (XIRYN_VAPID_PUBLIC_KEY and XIRYN_VAPID_PRIVATE_KEY). Until then, alerts stay in the open app."
              : push === "needs-install"
                ? "On iPhone, push is delivered only after you add Xiryn to the Home Screen."
                : push === "on"
                  ? "This install can receive push notifications."
                  : "Installed apps on iOS 16.4 and later can receive push when the keys are set. This screen falls back to alerts while the app is open."}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="label-mono">On this device</h2>
          <div className="rounded-2xl bg-elevated px-4 py-3 text-[14px]">
            <p>
              {stored} saved conversation{stored === 1 ? "" : "s"}
              {pending > 0 ? ` · ${pending} waiting to send` : ""}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Vault entries, keys and approval tokens are not stored here.
            </p>
          </div>
          {ios && (
            <button
              type="button"
              onClick={onGuide}
              className="flex min-h-12 items-center rounded-2xl bg-elevated px-4 text-left text-[15px]"
            >
              Add to Home Screen
            </button>
          )}
          <button
            type="button"
            onClick={onWorkspace}
            className="flex min-h-12 items-center justify-between rounded-2xl bg-elevated px-4 text-[15px]"
          >
            Providers, vault, integrations
            <ChevronRightIcon className="size-4 text-faint" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!online) {
                toast.add({
                  type: "error",
                  title: "Connect once so Xiryn can drop the saved sign-in.",
                })
              }
              onForget()
            }}
            className="flex min-h-12 items-center rounded-2xl bg-destructive/10 px-4 text-left text-[15px] text-destructive"
          >
            Sign out of this device
          </button>
          <p className="text-[12.5px] leading-relaxed text-faint">
            Clears the offline copy and asks the browser to forget basic auth. Face ID is
            not a second lock: a local prompt would not protect the cached pages, and
            Caddy remains the login.
          </p>
        </section>
      </div>
    </div>
  )
}
