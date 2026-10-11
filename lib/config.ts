import { eq } from "drizzle-orm"

import { db } from "@/db"
import { settings } from "@/db/schema"
import { providers, type ProviderId } from "@/lib/providers/catalog"

// Every value Oryn reads from its environment. A value saved from the
// Settings screen wins over the same value in .env, so the UI is always the
// source of truth once something has been set there.

type SettingDef = {
  env: string | null
  secret?: boolean
  fallback?: string
  // Written by Oryn itself, never through the Settings form
  internal?: boolean
}

const integrationSettings = {
  "model.default": { env: "ORYN_DEFAULT_MODEL" },
  "agent.maxSteps": { env: "ORYN_MAX_STEPS", fallback: "40" },
  "daytona.apiKey": { env: "DAYTONA_API_KEY", secret: true },
  "daytona.apiUrl": { env: "DAYTONA_API_URL", fallback: "https://app.daytona.io/api" },
  "daytona.target": { env: "DAYTONA_TARGET" },
  "daytona.autoStop": { env: "DAYTONA_AUTO_STOP_MINUTES", fallback: "15" },
  // Unset keeps workstations until you reset or delete the agent
  "daytona.autoDelete": { env: "DAYTONA_AUTO_DELETE_MINUTES" },
  "firecrawl.apiKey": { env: "FIRECRAWL_API_KEY", secret: true },
  "firecrawl.apiUrl": { env: "FIRECRAWL_API_URL", fallback: "https://api.firecrawl.dev" },
  "telegram.botToken": { env: "TELEGRAM_BOT_TOKEN", secret: true },
  // Only for self-hosted Bot API servers
  "telegram.apiUrl": { env: "TELEGRAM_API_URL", fallback: "https://api.telegram.org" },
  // Numeric Telegram user id allowed to talk to the bot; set by pairing
  "telegram.ownerId": { env: "TELEGRAM_OWNER_ID" },
  "telegram.ownerName": { env: null, internal: true },
  "telegram.pairCode": { env: null, internal: true },
  // JSON: which agent/squad and thread Telegram messages go to
  "telegram.target": { env: null, internal: true },
} satisfies Record<string, SettingDef>

const providerSettings = Object.fromEntries(
  providers.flatMap((p) => [
    [`provider.${p.id}.apiKey`, { env: p.keyEnv, secret: true }],
    [
      `provider.${p.id}.baseUrl`,
      { env: p.baseUrlEnv, fallback: p.defaultBaseUrl || undefined },
    ],
  ])
) as Record<`provider.${ProviderId}.${"apiKey" | "baseUrl"}`, SettingDef>

const definitions: Record<string, SettingDef> = {
  ...integrationSettings,
  ...providerSettings,
}

export type SettingKey = keyof typeof integrationSettings | keyof typeof providerSettings
export type SettingSource = "local" | "env" | "default" | null

export function isSettingKey(key: string): key is SettingKey {
  return key in definitions
}

// Keys the Settings screen may write
export function isWritableSetting(key: string): key is SettingKey {
  return isSettingKey(key) && !definitions[key].internal && key !== "telegram.ownerId"
}

export function isSecretSetting(key: SettingKey) {
  return !!definitions[key].secret
}

function envValue(key: SettingKey) {
  const name = definitions[key].env
  const value = name ? process.env[name]?.trim() : undefined
  return value || undefined
}

function storedValue(key: SettingKey) {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value || undefined
}

export function getSetting(key: SettingKey): string | undefined {
  return storedValue(key) ?? envValue(key) ?? definitions[key].fallback
}

export function getSettingSource(key: SettingKey): SettingSource {
  if (storedValue(key)) return "local"
  if (envValue(key)) return "env"
  if (definitions[key].fallback) return "default"
  return null
}

// Null or "" removes the saved value, so .env (or the default) applies again
export function setSetting(key: SettingKey, value: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) {
    db.delete(settings).where(eq(settings.key, key)).run()
    return
  }
  db.insert(settings)
    .values({ key, value: trimmed, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: trimmed, updatedAt: new Date() },
    })
    .run()
}

// Enough of a secret to recognise it, never enough to use it
export function maskSecret(value: string | undefined) {
  if (!value) return null
  if (value.length <= 8) return "••••"
  return `${value.slice(0, 3)}…${value.slice(-4)}`
}

export function describeSetting(key: SettingKey) {
  const value = getSetting(key)
  const source = getSettingSource(key)
  return {
    key,
    env: definitions[key].env,
    source,
    set: source === "local" || source === "env",
    value: isSecretSetting(key) ? maskSecret(value) : (value ?? null),
  }
}

export type SettingView = ReturnType<typeof describeSetting>

export function getMaxSteps() {
  const value = Number.parseInt(getSetting("agent.maxSteps") ?? "", 10)
  return Number.isFinite(value) && value > 0 ? Math.min(value, 200) : 40
}
