"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import { toast } from "@/components/ui/toast"
import type { OrynEvent } from "@/lib/events"

// Lets you know when an agent finishes, fails or needs you: a chime, a
// desktop notification when Oryn isn't the window you're looking at, and a
// toast when you're elsewhere in the app. Turned on or off per browser.

const PREFERENCE = "oryn.notifications"

type Notifications = {
  enabled: boolean
  permission: NotificationPermission | "unsupported"
  toggle: () => void
}

const NotificationsContext = React.createContext<Notifications>({
  enabled: false,
  permission: "unsupported",
  toggle: () => {},
})

export const useNotifications = () => React.useContext(NotificationsContext)

function readPreference() {
  try {
    return localStorage.getItem(PREFERENCE) !== "off"
  } catch {
    return true
  }
}

function writePreference(on: boolean) {
  try {
    localStorage.setItem(PREFERENCE, on ? "on" : "off")
  } catch {}
}

// A short chime, synthesized so there's no audio file to ship
let audio: AudioContext | null = null

function unlockAudio() {
  try {
    audio ??= new AudioContext()
    if (audio.state === "suspended") void audio.resume()
  } catch {}
}

function chime(kind: "done" | "attention" | "error") {
  try {
    unlockAudio()
    if (!audio) return
    const notes =
      kind === "attention"
        ? [784, 1047, 784, 1047]
        : kind === "error"
          ? [523, 392]
          : [659, 988]
    const start = audio.currentTime + 0.02
    notes.forEach((frequency, index) => {
      const oscillator = audio!.createOscillator()
      const gain = audio!.createGain()
      oscillator.type = "sine"
      oscillator.frequency.value = frequency
      const at = start + index * 0.13
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6)
      oscillator.connect(gain).connect(audio!.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.65)
    })
  } catch {}
}

function describe(event: OrynEvent) {
  if (event.type === "takeover") {
    return {
      kind: "attention" as const,
      title: `${event.name} needs you`,
      body: event.reason,
    }
  }
  return event.ok
    ? {
        kind: "done" as const,
        title: `${event.name} finished`,
        body: event.preview || "The reply is ready.",
      }
    : {
        kind: "error" as const,
        title: `${event.name} stopped`,
        body: event.error ?? "Something went wrong.",
      }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [enabled, setEnabled] = React.useState(true)
  const [permission, setPermission] =
    React.useState<Notifications["permission"]>("unsupported")

  // What's on screen right now, read when an event arrives
  const here = React.useRef({ pathname, enabled })
  React.useEffect(() => {
    here.current = { pathname, enabled }
  }, [pathname, enabled])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(readPreference())
    if ("Notification" in window) setPermission(Notification.permission)
    // Browsers only allow sound after the page has been interacted with
    const unlock = () => unlockAudio()
    window.addEventListener("pointerdown", unlock, { once: true })
    window.addEventListener("keydown", unlock, { once: true })
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
    }
  }, [])

  React.useEffect(() => {
    const source = new EventSource("/api/events")
    source.onmessage = (message) => {
      let event: OrynEvent
      try {
        event = JSON.parse(message.data) as OrynEvent
      } catch {
        return
      }
      router.refresh()
      if (!here.current.enabled) return

      const { kind, title, body } = describe(event)
      const looking = document.visibilityState === "visible" && document.hasFocus()
      const onThread = here.current.pathname === event.href.split("?")[0]
      // The thread you're reading already shows its own news
      if (looking && onThread) return

      chime(kind)
      if (looking) {
        toast.add({
          type: kind === "done" ? "success" : kind === "error" ? "error" : undefined,
          title,
          description: body.length > 160 ? `${body.slice(0, 160)}…` : body,
          timeout: kind === "attention" ? 0 : 8000,
          actionProps: {
            children: "Open",
            onClick: () => router.push(event.href),
          },
        })
        return
      }
      if ("Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(title, {
          body: body.slice(0, 300),
          tag: event.threadId,
          icon: "/icon.svg",
          silent: true,
          requireInteraction: kind === "attention",
        })
        notification.onclick = () => {
          window.focus()
          router.push(event.href)
          notification.close()
        }
      }
    }
    return () => source.close()
  }, [router])

  const toggle = React.useCallback(() => {
    const askable = "Notification" in window && Notification.permission === "default"
    // On, but the browser hasn't been asked yet: ask rather than mute
    const next = enabled && askable ? true : !enabled
    setEnabled(next)
    writePreference(next)
    if (!next) return
    unlockAudio()
    chime("done")
    if (askable) void Notification.requestPermission().then(setPermission)
  }, [enabled])

  const value = React.useMemo(
    () => ({ enabled, permission, toggle }),
    [enabled, permission, toggle]
  )
  return <NotificationsContext value={value}>{children}</NotificationsContext>
}
