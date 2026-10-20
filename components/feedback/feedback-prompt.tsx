"use client"

import * as React from "react"
import { MailIcon, StarIcon, ThumbsDownIcon, ThumbsUpIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/components/workspace/context"
import { useNotifications } from "@/components/workspace/notifier"
import { feedbackMailto, type FeedbackContext } from "@/lib/feedback"

// After a few finished tasks, a small card asks how Xiryn is doing. Answering
// opens a draft in the person's own email app; nothing is sent by Xiryn.
// It asks again only after many more tasks, and never if told not to.

const KEY = "xiryn.feedback"
const FIRST_ASK = 3
const ASK_AGAIN_AFTER = 25
const ASK_AGAIN_DAYS = 21
const REPO = "https://github.com/SouravBeraAkaSpeed/xiryn"

type Memory = {
  done: number
  askedAt?: number
  askedAtDone?: number
  never?: boolean
}

function read(): Memory {
  try {
    const raw = localStorage.getItem(KEY)
    const stored = raw ? (JSON.parse(raw) as Partial<Memory>) : {}
    return { ...stored, done: stored.done ?? 0 }
  } catch {
    return { done: 0 }
  }
}

function write(memory: Memory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {}
}

function due(memory: Memory, now = Date.now()) {
  if (memory.never) return false
  if (memory.askedAt === undefined) return memory.done >= FIRST_ASK
  const days = (now - memory.askedAt) / 86_400_000
  return (
    days >= ASK_AGAIN_DAYS && memory.done - (memory.askedAtDone ?? 0) >= ASK_AGAIN_AFTER
  )
}

export function platformName(platform: string) {
  if (platform.startsWith("win32")) return "Windows"
  if (platform.startsWith("darwin")) return "macOS"
  if (platform.startsWith("linux")) return "Linux"
  return platform
}

export function useFeedbackContext(model?: string | null): FeedbackContext {
  const { status } = useWorkspace()
  return {
    version: status.version,
    platform: platformName(status.platform),
    model: model ?? status.defaultModel,
  }
}

export function FeedbackPrompt() {
  const { listen } = useNotifications()
  const [open, setOpen] = React.useState(false)
  const [rating, setRating] = React.useState<"up" | "down" | null>(null)
  const [model, setModel] = React.useState<string | null>(null)
  const context = useFeedbackContext(model)

  React.useEffect(
    () =>
      listen((event) => {
        if (event.type !== "turn-finished" || !event.ok) return
        const memory = read()
        memory.done++
        if (due(memory)) {
          memory.askedAt = Date.now()
          memory.askedAtDone = memory.done
          setModel(event.model ?? null)
          setRating(null)
          setOpen(true)
        }
        write(memory)
      }),
    [listen]
  )

  if (!open) return null

  const close = (never = false) => {
    if (never) write({ ...read(), never: true })
    setOpen(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Feedback"
      className="fixed right-4 bottom-12 z-40 flex w-[min(340px,calc(100vw-2rem))] animate-in flex-col gap-3 rounded-xl border bg-popover p-4 shadow-xl ring-1 ring-foreground/5 duration-200 fade-in-0 slide-in-from-bottom-2"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="label-mono">{"// feedback"}</span>
          <span className="text-[14px] font-semibold">
            {rating === "up"
              ? "Glad it's working for you"
              : rating === "down"
                ? "Sorry about that"
                : "How's Xiryn working for you?"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => close()}
          aria-label="Close"
          className="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {rating === null ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => setRating("up")}>
            <ThumbsUpIcon data-icon="inline-start" />
            Going well
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRating("down")}>
            <ThumbsDownIcon data-icon="inline-start" />
            Not great
          </Button>
        </div>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {rating === "up"
              ? "Tell Sourav, who builds Xiryn, what you used it for and what would make it better. A star on GitHub helps others find it too."
              : "What went wrong? Your note goes straight to Sourav, who builds Xiryn, and helps fix it for everyone."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              render={<a href={feedbackMailto({ ...context, rating })} />}
              nativeButton={false}
              onClick={() => close()}
            >
              <MailIcon data-icon="inline-start" />
              Write to Sourav
            </Button>
            {rating === "up" && (
              <Button
                size="sm"
                variant="outline"
                render={<a href={REPO} target="_blank" rel="noreferrer" />}
                nativeButton={false}
                onClick={() => close()}
              >
                <StarIcon data-icon="inline-start" />
                Star on GitHub
              </Button>
            )}
          </div>
          <p className="font-mono text-[10.5px] text-faint">
            Opens your email app · nothing is sent automatically
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => close(true)}
        className="self-start font-mono text-[10.5px] text-faint hover:text-foreground"
      >
        don&apos;t ask again
      </button>
    </div>
  )
}
