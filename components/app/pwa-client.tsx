"use client"

import * as React from "react"

import { clearOfflineStore } from "@/lib/pwa/local-db"

// Registers the app-shell worker and drops the on-device copy when basic
// auth is no longer accepted (the worker posts `caches-cleared`).

export function PwaClient() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    let cancelled = false
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "caches-cleared") return
      void clearOfflineStore()
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener("message", onMessage)
    }
  }, [])
  return null
}
