"use client"

import Link from "next/link"
import { ChevronLeftIcon, MonitorIcon, ShareIcon, XIcon } from "lucide-react"

import { hapticTap } from "@/components/app/haptic"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { cn } from "@/lib/utils"

export function AppThreadHeader({
  kind,
  name,
  subtitle,
  glyphs,
  busy,
  online,
  screenOpen,
  onShare,
  onScreen,
  onCloseScreen,
}: {
  kind: "agent" | "squad"
  name: string
  subtitle: string
  glyphs: string[]
  busy: boolean
  online: boolean
  screenOpen: boolean
  onShare: () => void
  onScreen?: () => void
  onCloseScreen: () => void
}) {
  const status = !online ? "Offline" : busy ? "Working" : subtitle
  return (
    <header className="xiryn-only-app z-20 shrink-0 items-center gap-1 bg-background/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <Link
        href="/"
        aria-label="Back to chats"
        onClick={() => hapticTap()}
        className="grid size-11 shrink-0 place-items-center rounded-full text-foreground active:bg-accent"
      >
        <ChevronLeftIcon className="size-6" />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2">
        {kind === "agent" ? (
          <Glyph seed={glyphs[0] ?? name} className="size-9 shrink-0 rounded-full" />
        ) : (
          <SquadGlyph seeds={glyphs} className="size-9 shrink-0" />
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[16px] font-semibold tracking-tight">
            {name}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 truncate text-[12px]",
              !online ? "text-betelgeuse" : busy ? "text-rigel" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                !online
                  ? "bg-betelgeuse"
                  : busy
                    ? "animate-pulse-dot bg-rigel text-rigel"
                    : "bg-ok"
              )}
            />
            <span className="truncate">{status}</span>
          </span>
        </span>
      </div>
      <button
        type="button"
        aria-label="Share conversation"
        onClick={onShare}
        className="grid size-11 shrink-0 place-items-center rounded-full text-foreground active:bg-accent"
      >
        <ShareIcon className="size-5" />
      </button>
      {onScreen && (
        <button
          type="button"
          aria-label={screenOpen ? "Close the workstation" : "Open the workstation"}
          onClick={screenOpen ? onCloseScreen : onScreen}
          className="grid size-11 shrink-0 place-items-center rounded-full text-foreground active:bg-accent"
        >
          {screenOpen ? <XIcon className="size-5" /> : <MonitorIcon className="size-5" />}
        </button>
      )}
    </header>
  )
}
