"use client"

import { RotateCcwIcon } from "lucide-react"

import { useOffline } from "@/components/app/offline-provider"
import { cn } from "@/lib/utils"

const LABEL: Record<string, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
}

export function OutboxStrip({ threadId }: { threadId: string }) {
  const { online, outbox, retry } = useOffline()
  const mine = outbox.filter((item) => item.threadId === threadId)
  if (online && mine.length === 0) return null
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-2">
      {!online && (
        <p className="rounded-2xl bg-betelgeuse/12 px-3.5 py-2.5 text-[13.5px] leading-snug text-betelgeuse">
          Offline. The agent is not running. A message you write waits here and sends when
          the connection comes back.
        </p>
      )}
      {mine.map((item) => (
        <div key={item.id} className="flex justify-end">
          <div className="max-w-[min(85%,36rem)] min-w-0 rounded-2xl rounded-br-md bg-rigel/15 px-3.5 py-2.5 text-[16px] leading-snug">
            <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">{item.text}</p>
            <p className="mt-1.5 flex flex-wrap items-center justify-end gap-2 font-mono text-[11px] text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  item.state === "failed"
                    ? "bg-destructive"
                    : item.state === "sending"
                      ? "animate-pulse-dot bg-rigel text-rigel"
                      : "bg-betelgeuse"
                )}
              />
              {LABEL[item.state] ?? item.state}
              {item.error && item.state === "failed" ? ` · ${item.error}` : ""}
              {item.state === "failed" && (
                <button
                  type="button"
                  onClick={() => void retry(item.id)}
                  className="inline-flex items-center gap-1 text-rigel"
                >
                  <RotateCcwIcon className="size-3" />
                  Retry
                </button>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
