import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, beforeEach, test } from "node:test"

process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-google-"))
process.env.XIRYN_VAULT_KEY = randomBytes(32).toString("base64")
process.env.XIRYN_URL = "https://xiryn.test"
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com"
process.env.GOOGLE_CLIENT_SECRET = "client-secret-value"
delete process.env.GOOGLE_REFRESH_TOKEN

const { sqlite } = await import("@/db")
const { setSetting } = await import("@/lib/config")
const {
  disconnectGoogle,
  exchangeGoogleCode,
  googleAuthUrl,
  googleConnected,
  verifyGoogleState,
} = await import("./google")

const originalFetch = globalThis.fetch

after(() => {
  globalThis.fetch = originalFetch
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

beforeEach(() => {
  sqlite.exec("delete from settings;")
  delete process.env.GOOGLE_REFRESH_TOKEN
  globalThis.fetch = originalFetch
})

function formBody(init: RequestInit | undefined) {
  const body = init?.body
  if (body instanceof URLSearchParams) return body
  return new URLSearchParams(typeof body === "string" ? body : "")
}

test("the Google consent URL is bound with PKCE and does not keep older scopes", () => {
  const url = new URL(googleAuthUrl())
  assert.equal(url.searchParams.has("include_granted_scopes"), false)
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
  assert.equal(url.searchParams.has("code_verifier"), false)
  const state = url.searchParams.get("state")
  assert.ok(state)
  const verifier = verifyGoogleState(state)
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  assert.equal(url.searchParams.get("code_challenge"), challenge)
  assert.equal(url.toString().includes(verifier), false)
  assert.throws(() => verifyGoogleState(state), /already used or expired/)
})

test("connecting stores a sealed token and disconnect revokes that token", async () => {
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  const verifier = verifyGoogleState(state)
  let revoked: string | null = null
  globalThis.fetch = async (input, init) => {
    const target = String(input)
    const form = formBody(init)
    if (target === "https://oauth2.googleapis.com/token") {
      assert.equal(form.get("code_verifier"), verifier)
      assert.equal(form.get("grant_type"), "authorization_code")
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-from-google",
        expires_in: 3600,
      })
    }
    if (target === "https://oauth2.googleapis.com/revoke") {
      assert.equal(init?.method, "POST")
      revoked = form.get("token")
      return new Response(null, { status: 200 })
    }
    throw new Error(`unexpected ${target}`)
  }
  await exchangeGoogleCode("auth-code", verifier)
  assert.equal(googleConnected(), true)
  const result = await disconnectGoogle()
  assert.equal(revoked, "refresh-from-google")
  assert.equal(result.revoked, true)
  assert.equal(googleConnected(), false)
})

test("disconnect keeps an environment refresh token from turning Google back on", async () => {
  process.env.GOOGLE_REFRESH_TOKEN = "env-refresh-token"
  assert.equal(googleConnected(), true)
  let revoked: string | null = null
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/revoke")
    revoked = formBody(init).get("token")
    return new Response(null, { status: 200 })
  }
  const result = await disconnectGoogle()
  assert.equal(revoked, "env-refresh-token")
  assert.equal(result.revoked, true)
  assert.equal(process.env.GOOGLE_REFRESH_TOKEN, "env-refresh-token")
  assert.equal(googleConnected(), false)
})

test("a grant Google has already dropped still counts as revoked", async () => {
  setSetting("google.refreshToken", "already-dead")
  globalThis.fetch = async () =>
    Response.json({ error: "invalid_token" }, { status: 400 })
  const result = await disconnectGoogle()
  assert.equal(result.revoked, true)
  assert.equal(googleConnected(), false)
})

test("disconnect still turns Google off when the revoke request fails", async () => {
  setSetting("google.refreshToken", "still-valid")
  globalThis.fetch = async () => {
    throw new Error("offline")
  }
  const result = await disconnectGoogle()
  assert.equal(result.revoked, false)
  process.env.GOOGLE_REFRESH_TOKEN = "still-valid"
  assert.equal(googleConnected(), false)
})
