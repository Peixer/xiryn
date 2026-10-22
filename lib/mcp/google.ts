import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { getSetting, setSetting } from "@/lib/config"
import { sealText, unsealText } from "@/lib/vault"

// Built-in Gmail and Calendar. The refresh token is sealed with the vault key.
// The owner completes Google's consent in a browser at https://<host>; Xiryn
// never starts a browser of its own, so this works on a headless server.

const AAD = "google-refresh"
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

export function googleConnected() {
  return Boolean(getSetting("google.refreshToken"))
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
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + 10 * 60_000, n: randomBytes(16).toString("hex") })
  ).toString("base64url")
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
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("state", `${payload}.${mac}`)
  return url.toString()
}

export function verifyGoogleState(state: string) {
  const dot = state.lastIndexOf(".")
  if (dot <= 0)
    throw new Error("The Google sign-in state was not valid. Try connecting again.")
  const payload = state.slice(0, dot)
  const mac = state.slice(dot + 1)
  const expected = createHmac("sha256", clientCredentials().clientSecret)
    .update(payload)
    .digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("The Google sign-in state was not valid. Try connecting again.")
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    exp?: number
  }
  if (!parsed.exp || parsed.exp < Date.now()) {
    throw new Error("That Google sign-in link expired. Try connecting again.")
  }
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

export async function exchangeGoogleCode(code: string) {
  const redirect = googleRedirectUri()
  if (!redirect) throw new Error("XIRYN_URL is not set.")
  const { clientId, clientSecret } = clientCredentials()
  const json = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    })
  )
  if (!json.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Disconnect the app in your Google account and connect again."
    )
  }
  setSetting("google.refreshToken", sealText(AAD, json.refresh_token))
  accessCache = null
}

export function disconnectGoogle() {
  setSetting("google.refreshToken", null)
  accessCache = null
}

let accessCache: { token: string; expiresAt: number } | null = null

async function refreshToken() {
  const stored = getSetting("google.refreshToken")
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
