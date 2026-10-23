"use client"

import { pushClientConfig } from "@/actions/push"

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) output[index] = raw.charCodeAt(index)
  return output
}

export function installedApp() {
  if (typeof window === "undefined") return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  )
}

// iOS only delivers Web Push to an installed home-screen app (16.4+).
// Other browsers get the same call when they support PushManager.
export async function subscribeInstalledPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return "unsupported" as const
  if (!installedApp()) return "needs-install" as const
  const { publicKey } = await pushClientConfig()
  if (!publicKey) return "unconfigured" as const
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  const json = subscription.toJSON()
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: json }),
  })
  if (!response.ok) return "failed" as const
  return "on" as const
}
