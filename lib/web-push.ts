import { promises as fs } from "node:fs"
import path from "node:path"

import { DATA_DIR } from "@/db"
import { getSetting } from "@/lib/config"
import { subscribe, type XirynEvent } from "@/lib/events"
import { pushNotice } from "@/lib/pwa/push-payload"

// Web Push for an installed app (iOS 16.4+ and other browsers). Nothing is
// sent until both VAPID keys are set. The private key never leaves the server.

type Subscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

const FILE = () => path.join(DATA_DIR, "push-subscriptions.json")

function subject() {
  const value = getSetting("push.vapidSubject")?.trim()
  if (value && /^(mailto:|https:)/i.test(value)) return value
  return "mailto:xiryn@localhost"
}

export function pushKeys() {
  const publicKey = getSetting("push.vapidPublicKey")?.trim() || ""
  const privateKey = getSetting("push.vapidPrivateKey")?.trim() || ""
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: subject() }
}

async function readSubs(): Promise<Subscription[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE(), "utf8")) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSubscription)
  } catch {
    return []
  }
}

async function writeSubs(subs: Subscription[]) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(FILE(), `${JSON.stringify(subs)}\n`, { mode: 0o600 })
}

export function isSubscription(value: unknown): value is Subscription {
  if (!value || typeof value !== "object") return false
  const row = value as Subscription
  if (typeof row.endpoint !== "string" || row.endpoint.length > 2000) return false
  let url: URL
  try {
    url = new URL(row.endpoint)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const p256dh = row.keys?.p256dh
  const auth = row.keys?.auth
  if (typeof p256dh !== "string" || typeof auth !== "string") return false
  if (p256dh.length < 8 || p256dh.length > 256) return false
  if (auth.length < 4 || auth.length > 256) return false
  return true
}

export async function saveSubscription(value: unknown) {
  if (!isSubscription(value)) return false
  const subs = await readSubs()
  const next = subs.filter((row) => row.endpoint !== value.endpoint)
  next.push({
    endpoint: value.endpoint,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  })
  await writeSubs(next)
  return true
}

export async function removeSubscription(endpoint: string) {
  const subs = await readSubs()
  await writeSubs(subs.filter((row) => row.endpoint !== endpoint))
}

async function deliver(event: XirynEvent) {
  const notice = pushNotice(event)
  const keys = pushKeys()
  if (!notice || !keys) return
  const subs = await readSubs()
  if (subs.length === 0) return
  const webpush = await import("web-push")
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
  const payload = JSON.stringify(notice)
  const gone: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) gone.push(sub.endpoint)
      else console.error("[xiryn] web push failed:", status ?? "request failed")
    }
  }
  if (gone.length > 0) {
    const fresh = await readSubs()
    await writeSubs(fresh.filter((row) => !gone.includes(row.endpoint)))
  }
}

const globalForPush = globalThis as unknown as {
  __xirynWebPush?: { unsubscribe: () => void }
}

export function startWebPush() {
  globalForPush.__xirynWebPush?.unsubscribe()
  const unsubscribe = subscribe(
    (event) => {
      void deliver(event)
    },
    { background: true }
  )
  globalForPush.__xirynWebPush = { unsubscribe }
}

export function stopWebPush() {
  globalForPush.__xirynWebPush?.unsubscribe()
  globalForPush.__xirynWebPush = undefined
}
