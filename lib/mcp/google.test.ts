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
const { getSetting, setSetting } = await import("@/lib/config")
const {
  disconnectGoogle,
  exchangeGoogleCode,
  googleAccessToken,
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

test("an expired sign-in state is deleted and cannot be rewound", () => {
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  const realNow = Date.now
  Date.now = () => realNow() + 11 * 60_000
  try {
    assert.throws(() => verifyGoogleState(state), /expired/)
  } finally {
    Date.now = realNow
  }
  assert.throws(() => verifyGoogleState(state), /already used or expired/)
})

test("a tampered state does not consume the verifier", () => {
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  const dot = state.lastIndexOf(".")
  const tampered = `${state.slice(0, dot)}x.${state.slice(dot + 1)}`
  assert.throws(() => verifyGoogleState(tampered), /not valid/)
  const verifier = verifyGoogleState(state)
  assert.equal(verifier.length >= 43, true)
  assert.throws(() => verifyGoogleState(state), /already used or expired/)
})

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
  const stored = getSetting("google.refreshToken")
  assert.equal(stored?.startsWith("seal1."), true)
  assert.equal(stored?.includes("refresh-from-google"), false)
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
    throw new Error("offline still-valid")
  }
  const result = await disconnectGoogle()
  assert.equal(result.revoked, false)
  assert.equal(JSON.stringify(result).includes("still-valid"), false)
  process.env.GOOGLE_REFRESH_TOKEN = "still-valid"
  assert.equal(googleConnected(), false)
})

test("a sealed token that cannot be opened is not sent to Google", async () => {
  setSetting("google.refreshToken", "seal1.not-a-real-seal")
  globalThis.fetch = async () => {
    throw new Error("revoke should not run")
  }
  const result = await disconnectGoogle()
  assert.equal(result.revoked, false)
  assert.equal(JSON.stringify(result).includes("seal1"), false)
  assert.equal(googleConnected(), false)
})

async function connectSavedToken(refreshToken: string, code: string) {
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  const verifier = verifyGoogleState(state)
  globalThis.fetch = async (input, init) => {
    const target = String(input)
    if (target !== "https://oauth2.googleapis.com/token") {
      throw new Error(`unexpected ${target}`)
    }
    assert.equal(formBody(init).get("code_verifier"), verifier)
    return Response.json({
      access_token: "access-token",
      refresh_token: refreshToken,
      expires_in: 3600,
    })
  }
  await exchangeGoogleCode(code, verifier)
}

test("disconnect turns Google off before the revoke request finishes", async () => {
  setSetting("google.refreshToken", "still-valid")
  let releaseRevoke = () => {}
  const gate = new Promise<void>((resolve) => {
    releaseRevoke = resolve
  })
  let revokeStarted = () => {}
  const started = new Promise<void>((resolve) => {
    revokeStarted = resolve
  })
  let tokenCalls = 0
  globalThis.fetch = async (input) => {
    const target = String(input)
    if (target === "https://oauth2.googleapis.com/revoke") {
      revokeStarted()
      await gate
      return new Response(null, { status: 200 })
    }
    if (target === "https://oauth2.googleapis.com/token") {
      tokenCalls += 1
      return Response.json({ access_token: "should-not-mint", expires_in: 3600 })
    }
    throw new Error(`unexpected ${target}`)
  }
  const pending = disconnectGoogle()
  let result: { revoked: boolean }
  try {
    await started
    assert.equal(googleConnected(), false)
    await assert.rejects(googleAccessToken(), /not connected/)
    assert.equal(tokenCalls, 0)
  } finally {
    releaseRevoke()
    result = await pending
  }
  assert.equal(result.revoked, true)
  assert.equal(googleConnected(), false)
  assert.equal(JSON.stringify(result).includes("still-valid"), false)
})

test("a refresh already in flight cannot keep Google on after disconnect", async () => {
  setSetting("google.refreshToken", "still-valid")
  let releaseRefresh = () => {}
  const gate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  let refreshStarted = () => {}
  const started = new Promise<void>((resolve) => {
    refreshStarted = resolve
  })
  globalThis.fetch = async (input) => {
    const target = String(input)
    if (target === "https://oauth2.googleapis.com/token") {
      refreshStarted()
      await gate
      return Response.json({ access_token: "live-access", expires_in: 3600 })
    }
    if (target === "https://oauth2.googleapis.com/revoke") {
      return new Response(null, { status: 200 })
    }
    throw new Error(`unexpected ${target}`)
  }
  const pending = googleAccessToken()
  try {
    await started
    const result = await disconnectGoogle()
    assert.equal(result.revoked, true)
    assert.equal(googleConnected(), false)
  } finally {
    releaseRefresh()
  }
  await assert.rejects(pending, /not connected/)
  await assert.rejects(googleAccessToken(), /not connected/)
})

test("reconnecting revokes the refresh token that was saved before", async () => {
  await connectSavedToken("refresh-one", "code-one")
  const revoked: string[] = []
  globalThis.fetch = async (input, init) => {
    const target = String(input)
    if (target === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "access-two",
        refresh_token: "refresh-two",
        expires_in: 3600,
      })
    }
    if (target === "https://oauth2.googleapis.com/revoke") {
      assert.equal(init?.method, "POST")
      revoked.push(formBody(init).get("token") ?? "")
      return new Response(null, { status: 200 })
    }
    throw new Error(`unexpected ${target}`)
  }
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  await exchangeGoogleCode("code-two", verifyGoogleState(state))
  assert.deepEqual(revoked, ["refresh-one"])
  assert.equal(googleConnected(), true)
})

test("connecting still succeeds when the previous grant cannot be revoked", async () => {
  await connectSavedToken("refresh-one", "code-one")
  let revokeAttempts = 0
  globalThis.fetch = async (input) => {
    const target = String(input)
    if (target === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "access-two",
        refresh_token: "refresh-two",
        expires_in: 3600,
      })
    }
    if (target === "https://oauth2.googleapis.com/revoke") {
      revokeAttempts += 1
      throw new Error("offline refresh-one")
    }
    throw new Error(`unexpected ${target}`)
  }
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  await exchangeGoogleCode("code-two", verifyGoogleState(state))
  assert.equal(revokeAttempts, 1)
  assert.equal(googleConnected(), true)
})

test("connecting does not revoke a refresh token that exists only in the environment", async () => {
  process.env.GOOGLE_REFRESH_TOKEN = "env-refresh-token"
  let revoked = false
  globalThis.fetch = async (input) => {
    const target = String(input)
    if (target === "https://oauth2.googleapis.com/revoke") {
      revoked = true
      return new Response(null, { status: 200 })
    }
    if (target === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "access-token",
        refresh_token: "from-oauth",
        expires_in: 3600,
      })
    }
    throw new Error(`unexpected ${target}`)
  }
  const url = new URL(googleAuthUrl())
  const state = url.searchParams.get("state")
  assert.ok(state)
  await exchangeGoogleCode("code", verifyGoogleState(state))
  assert.equal(revoked, false)
  assert.equal(googleConnected(), true)
  assert.equal(process.env.GOOGLE_REFRESH_TOKEN, "env-refresh-token")
})
