import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { getSetting, setSetting } from "@/lib/config"
import { sealText, unsealText } from "@/lib/vault"

// Built-in Gmail and Calendar. The refresh token is sealed with the vault key.
// The owner completes Google's consent in a browser at https://<host>; Xiryn
// never starts a browser of its own, so this works on a headless server.

const AAD = "google-refresh"
const DISCONNECTED = "1"
const STATE_TTL_MS = 10 * 60_000

type PendingOAuth = { verifier: string; exp: number }

const globalForOAuth = globalThis as unknown as {
  __xirynGoogleOAuth?: Map<string, PendingOAuth>
}
const pendingOAuth = (globalForOAuth.__xirynGoogleOAuth ??= new Map())

function rememberVerifier(nonce: string, verifier: string, exp: number) {
  const now = Date.now()
  for (const [key, row] of pendingOAuth) {
    if (row.exp < now) pendingOAuth.delete(key)
  }
  pendingOAuth.set(nonce, { verifier, exp })
}

function takeVerifier(nonce: string) {
  const row = pendingOAuth.get(nonce)
  pendingOAuth.delete(nonce)
  if (!row || row.exp < Date.now()) return null
  return row.verifier
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
]

export function googleRedirectUri() {
  const raw = process.env.XIRYN_URL?.trim()
  if (!raw) return null
  try {
    return new URL("/api/google/oauth/callback", raw).toString()
  } catch {
    return null
  }
}

export function googleConfigured() {
  return Boolean(getSetting("google.clientId") && getSetting("google.clientSecret"))
}

function storedRefreshToken() {
  if (getSetting("google.disconnected") === DISCONNECTED) return undefined
  return getSetting("google.refreshToken")
}

export function googleConnected() {
  return Boolean(storedRefreshToken())
}

function clientCredentials() {
  const clientId = getSetting("google.clientId")
  const clientSecret = getSetting("google.clientSecret")
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google needs a client id and secret. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then connect from Settings → Connectors."
    )
  }
  return { clientId, clientSecret }
}

export function googleAuthUrl() {
  const redirect = googleRedirectUri()
  if (!redirect) {
    throw new Error(
      "Set XIRYN_URL to the address you open Xiryn at (https://your-host) before connecting Google. That address is the OAuth redirect."
    )
  }
  const { clientId } = clientCredentials()
  const exp = Date.now() + STATE_TTL_MS
  const nonce = randomBytes(16).toString("hex")
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  rememberVerifier(nonce, verifier, exp)
  const payload = Buffer.from(JSON.stringify({ exp, n: nonce })).toString("base64url")
  const mac = createHmac("sha256", clientCredentials().clientSecret)
    .update(payload)
    .digest("base64url")
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirect)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", SCOPES.join(" "))
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", `${payload}.${mac}`)
  return url.toString()
}

const invalidState = "The Google sign-in state was not valid. Try connecting again."

export function verifyGoogleState(state: string) {
  const dot = state.lastIndexOf(".")
  if (dot <= 0) throw new Error(invalidState)
  const payload = state.slice(0, dot)
  const mac = state.slice(dot + 1)
  const expected = createHmac("sha256", clientCredentials().clientSecret)
    .update(payload)
    .digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error(invalidState)
  let parsed: { exp?: unknown; n?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown
      n?: unknown
    }
  } catch {
    throw new Error(invalidState)
  }
  if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
    if (typeof parsed.n === "string") pendingOAuth.delete(parsed.n)
    throw new Error("That Google sign-in link expired. Try connecting again.")
  }
  if (typeof parsed.n !== "string" || !parsed.n) throw new Error(invalidState)
  const verifier = takeVerifier(parsed.n)
  if (!verifier) {
    throw new Error(
      "That Google sign-in link was already used or expired. Try connecting again."
    )
  }
  return verifier
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await response.json().catch(() => null)) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  } | null
  if (!response.ok || !json?.access_token) {
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Google token request failed (${response.status}).`
    )
  }
  return json
}

export async function exchangeGoogleCode(code: string, verifier: string) {
  const redirect = googleRedirectUri()
  if (!redirect) throw new Error("XIRYN_URL is not set.")
  if (!verifier) throw new Error(invalidState)
  const { clientId, clientSecret } = clientCredentials()
  const json = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code_verifier: verifier,
    })
  )
  if (!json.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect the app in your Google account and connect again."
    )
  }
  setSetting("google.refreshToken", sealText(AAD, json.refresh_token))
  setSetting("google.disconnected", null)
  accessCache = null
}

async function revokeRefreshToken(token: string) {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text().catch(() => "")
    if (response.ok) return true
    const json = JSON.parse(text) as { error?: string }
    return json.error === "invalid_token"
  } catch {
    return false
  }
}

export async function disconnectGoogle() {
  const stored = getSetting("google.refreshToken")
  accessCache = null
  let revoked = !stored
  if (stored) {
    try {
      revoked = await revokeRefreshToken(unsealText(AAD, stored))
    } catch {
      revoked = false
    }
  }
  setSetting("google.refreshToken", null)
  setSetting("google.disconnected", DISCONNECTED)
  return { revoked }
}

let accessCache: { token: string; expiresAt: number } | null = null

async function refreshToken() {
  const stored = storedRefreshToken()
  if (!stored) {
    throw new Error(
      "Google is not connected. Open Settings → Connectors and connect Gmail and Calendar."
    )
  }
  return unsealText(AAD, stored)
}

export async function googleAccessToken() {
  if (accessCache && accessCache.expiresAt > Date.now() + 60_000) return accessCache.token
  const { clientId, clientSecret } = clientCredentials()
  const json = await tokenRequest(
    new URLSearchParams({
      refresh_token: await refreshToken(),
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    })
  )
  accessCache = {
    token: json.access_token!,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
  return accessCache.token
}

export async function googleFetch(url: string, init?: RequestInit) {
  const token = await googleAccessToken()
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Google ${response.status}: ${text.slice(0, 300) || response.statusText}`
    )
  }
  return text ? (JSON.parse(text) as unknown) : null
}

export function connectorEnabled(name: "gmail" | "calendar") {
  return googleConnected() && getSetting(`connectors.${name}`) !== "off"
}
