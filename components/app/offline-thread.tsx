"use client"

import * as React from "react"
import { formatDistanceToNowStrict } from "date-fns"

import { Composer } from "@/components/thread/composer"
import { Glyph } from "@/components/glyph"
import { useOffline } from "@/components/app/offline-provider"
import { toast } from "@/components/ui/toast"
import type { StoredMessage } from "@/lib/pwa/sanitize"

function Bubble({ message }: { message: StoredMessage }) {
  const mine = message.role === "user"
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          mine
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-rigel/15 px-3.5 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap"
            : "max-w-[85%] text-[16px] leading-relaxed whitespace-pre-wrap"
        }
      >
        {message.text || (mine ? "" : "…")}
      </div>
    </div>
  )
}

export function OfflineThread({
  threadId,
  onClose,
}: {
  threadId: string
  onClose: () => void
}) {
  const { storedThreads, enqueue, online } = useOffline()
  const thread = storedThreads.find((item) => item.threadId === threadId)
  const [sharing, setSharing] = React.useState(false)

  const share = async () => {
    const text = (thread?.messages ?? [])
      .map(
        (message) =>
          `${message.role === "user" ? "You" : thread?.agentName}: ${message.text}`
      )
      .join("\n\n")
    if (!text) return
    setSharing(true)
    try {
      if (navigator.share)
        await navigator.share({ title: thread?.agentName ?? "Xiryn", text })
      else {
        await navigator.clipboard.writeText(text)
        toast.add({ type: "success", title: "Copied" })
      }
    } catch {
      // The share sheet was dismissed.
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex items-center gap-2 px-2 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={onClose}
          className="grid size-11 place-items-center rounded-full active:bg-accent"
          aria-label="Back"
        >
          ‹
        </button>
        <Glyph seed={thread?.glyph || "xiryn"} className="size-9 rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">
            {thread?.agentName ?? "Conversation"}
          </span>
          <span className="block truncate text-[12px] text-betelgeuse">
            Saved on this device
            {thread?.activeAt
              ? ` · ${formatDistanceToNowStrict(new Date(thread.activeAt), { addSuffix: true })}`
              : ""}
          </span>
        </span>
        <button
          type="button"
          aria-label="Share conversation"
          disabled={sharing || !thread?.messages.length}
          onClick={() => void share()}
          className="grid size-11 place-items-center rounded-full active:bg-accent disabled:opacity-30"
        >
          Share
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="rounded-2xl bg-elevated px-3.5 py-2.5 text-[13px] leading-snug text-muted-foreground">
          Saved on this device. Nothing is running, and the agent has not seen a new
          message.
        </p>
        {thread && thread.messages.length > 0 ? (
          thread.messages.map((message) => <Bubble key={message.id} message={message} />)
        ) : (
          <p className="px-1 text-[15px] text-muted-foreground">
            This conversation isn&apos;t saved on this device yet. Open it once while
            you&apos;re online.
          </p>
        )}
      </div>
      <div className="xiryn-composer bg-background">
        <Composer
          draftKey={`offline:${threadId}`}
          placeholder={online ? "Message…" : "Write a message to send later…"}
          busy={false}
          modelSpec={null}
          onStop={() => {}}
          onSend={async (text, files) => {
            if (files.length > 0) {
              toast.add({
                type: "error",
                title: "Photos and files wait until you're back online.",
              })
              throw new Error("offline-files")
            }
            const trimmed = text.trim()
            if (!trimmed) return
            await enqueue({
              threadId,
              text: trimmed,
            })
          }}
        />
      </div>
    </div>
  )
}
