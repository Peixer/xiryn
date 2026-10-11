"use client"

import * as React from "react"
import type RFB from "@novnc/novnc"
import {
  ExpandIcon,
  HandIcon,
  EyeIcon,
  MonitorIcon,
  PlugZapIcon,
  RefreshCwIcon,
} from "lucide-react"

import { desktopStreamUrl } from "@/actions/workstation"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type State = "idle" | "connecting" | "connected" | "disconnected" | "error"

export function Screen({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const frameRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLDivElement>(null)
  const clientRef = React.useRef<RFB | null>(null)
  const attemptRef = React.useRef(0)
  const [state, setState] = React.useState<State>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [interactive, setInteractive] = React.useState(false)

  const connect = React.useCallback(async () => {
    const attempt = ++attemptRef.current
    clientRef.current?.disconnect()
    clientRef.current = null
    setState("connecting")
    setError(null)
    try {
      const [url, { default: Client }] = await Promise.all([
        desktopStreamUrl(agentId),
        import("@novnc/novnc"),
      ])
      if (attempt !== attemptRef.current || !canvasRef.current) return
      canvasRef.current.replaceChildren()
      const rfb = new Client(canvasRef.current, url)
      rfb.scaleViewport = true
      rfb.background = "transparent"
      rfb.viewOnly = true
      rfb.addEventListener(
        "connect",
        () => attempt === attemptRef.current && setState("connected")
      )
      rfb.addEventListener("disconnect", () => {
        if (attempt !== attemptRef.current) return
        clientRef.current = null
        setState("disconnected")
      })
      clientRef.current = rfb
    } catch (cause) {
      if (attempt !== attemptRef.current) return
      setState("error")
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [agentId])

  React.useEffect(() => {
    if (clientRef.current) {
      clientRef.current.viewOnly = !interactive
      if (interactive) clientRef.current.focus()
    }
  }, [interactive, state])

  React.useEffect(
    () => () => {
      attemptRef.current++
      clientRef.current?.disconnect()
      clientRef.current = null
    },
    []
  )

  const live = state === "connected"

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
        <span
          className={cn(
            "size-1.5 rounded-full",
            live
              ? "bg-ok"
              : state === "connecting"
                ? "animate-pulse-dot bg-rigel text-rigel"
                : "bg-faint/60"
          )}
        />
        <span>display :0</span>
        <span className="text-faint">·</span>
        <span>{live ? (interactive ? "you have control" : "view only") : state}</span>
        <div className="ml-auto flex items-center gap-1">
          {live && (
            <Button
              size="xs"
              variant={interactive ? "secondary" : "ghost"}
              onClick={() => setInteractive((value) => !value)}
              className="font-mono text-[10.5px]"
            >
              {interactive ? (
                <HandIcon data-icon="inline-start" />
              ) : (
                <EyeIcon data-icon="inline-start" />
              )}
              {interactive ? "control" : "watch"}
            </Button>
          )}
          {(live || state === "disconnected" || state === "error") && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Reconnect"
              onClick={connect}
            >
              <RefreshCwIcon />
            </Button>
          )}
          {live && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Fullscreen"
              onClick={() => frameRef.current?.requestFullscreen?.()}
            >
              <ExpandIcon />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={frameRef}
        className={cn(
          "relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-[oklch(0.12_0.01_265)]",
          interactive && live && "ring-2 ring-rigel/50"
        )}
      >
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div ref={canvasRef} className="absolute inset-0 [&_canvas]:!cursor-default" />
        {!live && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            {state === "connecting" ? (
              <div className="flex flex-col items-center gap-3">
                <Spinner className="size-5 text-rigel" />
                <span className="font-mono text-[11px] text-white/60">
                  waking workstation · starting desktop
                </span>
              </div>
            ) : !enabled ? (
              <div className="flex max-w-60 flex-col items-center gap-2">
                <MonitorIcon className="size-6 text-white/40" />
                <p className="text-[12.5px] text-white/60">
                  Workstations are off. Add a Daytona key in Settings to give this agent a
                  desktop.
                </p>
              </div>
            ) : (
              <div className="flex max-w-64 flex-col items-center gap-3">
                <MonitorIcon className="size-6 text-white/40" />
                <p className="text-[12.5px] text-white/60">
                  {state === "error"
                    ? error
                    : state === "disconnected"
                      ? "The desktop stream closed."
                      : "Watch the agent's desktop live, or take the mouse yourself."}
                </p>
                <Button size="sm" variant="secondary" onClick={connect}>
                  <PlugZapIcon data-icon="inline-start" />
                  {state === "idle" ? "Connect" : "Reconnect"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint">
        Connecting boots the workstation if it is asleep. It stops on its own after a
        period of inactivity.
      </p>
    </div>
  )
}
