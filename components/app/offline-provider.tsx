"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  clearOfflineStore,
  deleteOutbox,
  listOutbox,
  listStoredThreads,
  saveOutbox,
  type OutboxRecord,
  type StoredThread,
} from "@/lib/pwa/local-db"
import {
  isNetworkFailure,
  presence,
  shouldFlushOutbox,
  type FlushReason,
} from "@/lib/pwa/offline"
import { flushOutbox, transition } from "@/lib/pwa/outbox"

type OfflineValue = {
  online: boolean
  outbox: OutboxRecord[]
  storedThreads: StoredThread[]
  enqueue: (input: { threadId: string; agentId?: string; text: string }) => Promise<void>
  retry: (id: string) => Promise<void>
  forgetDevice: () => Promise<void>
  reloadLocal: () => Promise<void>
}

const OfflineContext = React.createContext<OfflineValue | null>(null)

export function useOffline() {
  const value = React.useContext(OfflineContext)
  if (!value) throw new Error("useOffline must be used inside OfflineProvider")
  return value
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [online, setOnline] = React.useState(true)
  const [outbox, setOutbox] = React.useState<OutboxRecord[]>([])
  const [storedThreads, setStoredThreads] = React.useState<StoredThread[]>([])
  const flushing = React.useRef(false)
  const outboxRef = React.useRef(outbox)

  const reloadLocal = React.useCallback(async () => {
    const [messages, threads] = await Promise.all([listOutbox(), listStoredThreads()])
    outboxRef.current = messages
    setOutbox(messages)
    setStoredThreads(threads)
  }, [])

  const applyRecord = React.useCallback(
    async (record: OutboxRecord) => {
      if (record.state === "sent") await deleteOutbox(record.id)
      else await saveOutbox(record)
      setOutbox((current) => {
        const next = current.filter((item) => item.id !== record.id)
        if (record.state !== "sent") next.push(record)
        next.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        outboxRef.current = next
        return next
      })
      if (record.state === "sent") router.refresh()
    },
    [router]
  )

  const flush = React.useCallback(
    async (reason: FlushReason) => {
      const isOnline = presence(navigator.onLine) === "online"
      setOnline(isOnline)
      if (!shouldFlushOutbox({ reason, online: isOnline })) return
      if (flushing.current) return
      flushing.current = true
      try {
        const pending = outboxRef.current.filter(
          (item) => item.state === "queued" || item.state === "failed"
        )
        await flushOutbox(
          pending,
          true,
          async (item) => {
            try {
              const response = await fetch(
                `/api/threads/${encodeURIComponent(item.threadId)}/turn`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    message: {
                      id: item.id,
                      role: "user",
                      parts: [{ type: "text", text: item.text }],
                    },
                    ...(item.agentId ? { agentId: item.agentId } : {}),
                  }),
                }
              )
              await response.body?.cancel().catch(() => {})
              if (!response.ok) {
                return { ok: false as const, network: false, status: response.status }
              }
              return { ok: true as const }
            } catch (error) {
              if (isNetworkFailure(error, navigator.onLine)) {
                return { ok: false as const, network: true }
              }
              return { ok: false as const, network: false }
            }
          },
          (item, state, error) => {
            const current = outboxRef.current.find((row) => row.id === item.id) ?? item
            void applyRecord({ ...current, state, error })
          }
        )
      } finally {
        flushing.current = false
      }
    },
    [applyRecord]
  )

  React.useEffect(() => {
    let cancelled = false
    // IndexedDB is only available after mount. The queue has to be read before the first flush.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadLocal().then(() => {
      if (!cancelled) void flush("start")
    })
    const onOnline = () => {
      setOnline(true)
      void flush("online")
    }
    const onOffline = () => setOnline(false)
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush("visible")
    }
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    document.addEventListener("visibilitychange", onVisible)
    setOnline(presence(navigator.onLine) === "online")
    return () => {
      cancelled = true
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [flush, reloadLocal])

  const enqueue = React.useCallback(
    async (input: { threadId: string; agentId?: string; text: string }) => {
      const record: OutboxRecord = {
        id: crypto.randomUUID(),
        threadId: input.threadId,
        agentId: input.agentId,
        text: input.text.slice(0, 100_000),
        createdAt: new Date().toISOString(),
        state: transition("queued", { type: "enqueue" }),
      }
      await saveOutbox(record)
      setOutbox((current) => {
        const next = [...current, record]
        outboxRef.current = next
        return next
      })
    },
    []
  )

  const retry = React.useCallback(
    async (id: string) => {
      const current = outboxRef.current.find((item) => item.id === id)
      if (!current) return
      const next = {
        ...current,
        state: transition(current.state, { type: "retry" }),
        error: undefined,
      }
      await saveOutbox(next)
      outboxRef.current = outboxRef.current.map((item) => (item.id === id ? next : item))
      setOutbox(outboxRef.current)
      await flush("online")
    },
    [flush]
  )

  const forgetDevice = React.useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker?.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {})
        await subscription.unsubscribe().catch(() => {})
      }
      registration?.active?.postMessage({ type: "clear" })
    } catch {
      // The local copy is still removed below.
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {
      // The worker was also asked to drop its caches.
    }
    await clearOfflineStore()
    setOutbox([])
    setStoredThreads([])
    outboxRef.current = []
    try {
      // Replacing the cached basic-auth credentials makes Caddy ask again.
      await fetch("/", {
        headers: { Authorization: `Basic ${btoa("xiryn-sign-out:0")}` },
        cache: "no-store",
      })
    } catch {
      // Offline. The caches are already cleared.
    }
    // A full load, not a client transition: the worker and basic auth have to start over.
    window.location.replace(`${window.location.origin}/`)
  }, [])

  const value = React.useMemo(
    () => ({
      online,
      outbox,
      storedThreads,
      enqueue,
      retry,
      forgetDevice,
      reloadLocal,
    }),
    [online, outbox, storedThreads, enqueue, retry, forgetDevice, reloadLocal]
  )

  return <OfflineContext value={value}>{children}</OfflineContext>
}
