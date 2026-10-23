import { eq } from "drizzle-orm"

import { db } from "@/db"
import { settings } from "@/db/schema"
import { providers, type ProviderId } from "@/lib/providers/catalog"

// Every value Xiryn reads from its environment. A value saved from the
// Settings screen wins over the same value in .env, so the UI is always the
// source of truth once something has been set there.

type SettingDef = {
  env: string | null
  secret?: boolean
  fallback?: string
  // Written by Xiryn itself, never through the Settings form
  internal?: boolean
}

const integrationSettings = {
  "model.default": { env: "XIRYN_DEFAULT_MODEL" },
  "agent.maxSteps": { env: "XIRYN_MAX_STEPS", fallback: "40" },
  // US dollars a month; once reached, turns on paid models wait for next month
  "usage.monthlyBudget": { env: "XIRYN_MONTHLY_BUDGET" },
  // JSON: optional USD monthly limit per agent id. Written from the Usage page.
  "usage.agentBudgets": { env: null, internal: true },
  // Operating-system notifications when no Xiryn tab is open: "on" or "off"
  "notify.desktop": { env: "XIRYN_DESKTOP_NOTIFY", fallback: "on" },
  // POST a short notice when a task finishes or needs you. The URL is a secret.
  // Format: ntfy, slack, or json. Triggers: finished, failed, approval,
  // takeover, secret — or "none". Preview text is off unless set to "on".
  "notify.webhookUrl": { env: "XIRYN_NOTIFY_WEBHOOK_URL", secret: true },
  "notify.webhookFormat": { env: "XIRYN_NOTIFY_WEBHOOK_FORMAT", fallback: "json" },
  "notify.webhookTriggers": {
    env: "XIRYN_NOTIFY_WEBHOOK_TRIGGERS",
    fallback: "finished,failed,approval,takeover,secret",
  },
  "notify.webhookPreview": { env: "XIRYN_NOTIFY_WEBHOOK_PREVIEW", fallback: "off" },
  // JSON: prices the person set for models Xiryn doesn't know, by model spec
  "pricing.custom": { env: null, internal: true },
  // Limits for each agent's workstation container
  "workstation.cpus": { env: "XIRYN_WORKSTATION_CPUS", fallback: "2" },
  "workstation.memory": { env: "XIRYN_WORKSTATION_MEMORY_GB", fallback: "4" },
  // Idle minutes before a workstation stops itself; 0 keeps it running
  "workstation.autoStop": { env: "XIRYN_WORKSTATION_AUTO_STOP_MINUTES", fallback: "15" },
  // Unset keeps workstations until you reset or delete the agent
  "workstation.autoDelete": { env: "XIRYN_WORKSTATION_AUTO_DELETE_MINUTES" },
  // "off" leaves the phone link out of Telegram hand-off notices
  "workstation.phoneLinks": { env: "XIRYN_PHONE_TAKEOVER", fallback: "on" },
  "workstation.installId": { env: null, internal: true },
  // "off" stops the update check and star count (the only request Xiryn makes
  // on its own, to GitHub's public API)
  "updates.check": { env: "XIRYN_UPDATE_CHECK", fallback: "on" },
  "firecrawl.apiKey": { env: "FIRECRAWL_API_KEY", secret: true },
  "firecrawl.apiUrl": { env: "FIRECRAWL_API_URL", fallback: "https://api.firecrawl.dev" },
  // "off" (default) | "new-domains" | "always". See lib/agent/untrusted.ts.
  "security.webApproval": { env: "XIRYN_WEB_APPROVAL", fallback: "off" },
  // Hostnames web_fetch may call without asking, when approval is new-domains.
  "security.webAllowlist": { env: "XIRYN_WEB_ALLOWLIST" },
  "telegram.botToken": { env: "TELEGRAM_BOT_TOKEN", secret: true },
  // Only for self-hosted Bot API servers
  "telegram.apiUrl": { env: "TELEGRAM_API_URL", fallback: "https://api.telegram.org" },
  // Numeric Telegram user id allowed to talk to the bot; set by pairing
  "telegram.ownerId": { env: "TELEGRAM_OWNER_ID" },
  // Finished tasks started in the app: "long" (a minute or more), "all" or "off"
  "telegram.notify": { env: "XIRYN_TELEGRAM_NOTIFY", fallback: "long" },
  "telegram.ownerName": { env: null, internal: true },
  "telegram.pairCode": { env: null, internal: true },
  // JSON: which agent/squad and thread Telegram messages go to
  "telegram.target": { env: null, internal: true },
  // Google OAuth for the built-in Gmail, Calendar and Drive connectors
  "google.clientId": { env: "GOOGLE_CLIENT_ID" },
  "google.clientSecret": { env: "GOOGLE_CLIENT_SECRET", secret: true },
  // Sealed refresh token written by the OAuth callback, or a raw token in env
  "google.refreshToken": { env: "GOOGLE_REFRESH_TOKEN", secret: true, internal: true },
  // Space-separated scopes Google returned. Not a secret. "none" means we asked
  // and Drive was not among them. Unset means this token has not been refreshed
  // since Drive was added, so Drive stays off until a reconnect.
  "google.grantedScopes": { env: null, internal: true },
  // "1" after Disconnect, so an env refresh token cannot turn the connector back on
  "google.disconnected": { env: null, internal: true },
  // "off" hides that connector's tools. Gmail and Calendar default on, once
  // Google is connected. Drive defaults off so an existing Gmail consent is
  // not asked for a new scope until the owner turns Drive on.
  "connectors.gmail": { env: "XIRYN_GMAIL", fallback: "on" },
  "connectors.calendar": { env: "XIRYN_CALENDAR", fallback: "on" },
  "connectors.drive": { env: "XIRYN_DRIVE", fallback: "off" },
  // "readonly" (default) or "readwrite". Read-write asks for the full Drive
  // scope on the next connect. See lib/mcp/drive-scopes.ts.
  "connectors.drive.access": { env: "XIRYN_DRIVE_ACCESS", fallback: "readonly" },
  // Extra program names allowed to launch MCP stdio servers, comma-separated.
  // npx, uvx, node, python3, python, docker and bunx are always allowed.
  "mcp.allowedCommands": { env: "XIRYN_MCP_ALLOWED_COMMANDS" },
  // Bearer token for POST /api/hooks/routines/<id>. Unset, that route is 404.
  "hooks.token": { env: "XIRYN_HOOKS_TOKEN", secret: true },
  // Hostnames allowed for "Import Grok Bot" share links. Empty means any
  // public https host. Loopback and private addresses are never allowed.
  "grokbot.importHosts": { env: "XIRYN_GROKBOT_IMPORT_HOSTS" },
  // Web Push for an installed app. Both keys are required before anything is
  // sent. The private key stays on the server. Generate a pair with
  // `npx web-push generate-vapid-keys`.
  "push.vapidPublicKey": { env: "XIRYN_VAPID_PUBLIC_KEY", internal: true },
  "push.vapidPrivateKey": {
    env: "XIRYN_VAPID_PRIVATE_KEY",
    secret: true,
    internal: true,
  },
  "push.vapidSubject": { env: "XIRYN_VAPID_SUBJECT", internal: true },
} satisfies Record<string, SettingDef>

// Bedrock does not use one API key. These sit beside the generic apiKey/baseUrl
// rows the provider loop creates (base URL is an optional VPC endpoint).
const bedrockSettings = {
  "provider.bedrock.region": { env: "AWS_REGION", fallback: "eu-west-3" },
  "provider.bedrock.accessKeyId": { env: "AWS_ACCESS_KEY_ID", secret: true },
  "provider.bedrock.secretAccessKey": { env: "AWS_SECRET_ACCESS_KEY", secret: true },
  "provider.bedrock.sessionToken": { env: "AWS_SESSION_TOKEN", secret: true },
  // Comma-separated regions to list and call in addition to AWS_REGION.
  "bedrock.extraRegions": { env: "XIRYN_BEDROCK_EXTRA_REGIONS" },
  // model-id=region pairs. Overrides the extra-region catalog and discovery.
  "bedrock.modelRegions": { env: "XIRYN_BEDROCK_MODEL_REGIONS" },
  // model-id=tokens pairs. Overrides the built-in output ceilings.
  "bedrock.maxOutput": { env: "XIRYN_BEDROCK_MAX_OUTPUT" },
  // Bedrock prompt caching: on unless this is off/0/false (see lib/providers/prompt-cache.ts)
  "cache.prompt": { env: "XIRYN_PROMPT_CACHE" },
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
  ...bedrockSettings,
}

export type SettingKey =
  | keyof typeof integrationSettings
  | keyof typeof providerSettings
  | keyof typeof bedrockSettings
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
