import assert from "node:assert/strict"
import vm from "node:vm"
import { test } from "node:test"

import {
  CACHE_POLICY,
  decideCache,
  serviceWorkerSource,
  shouldClearCaches,
  shouldStoreResponse,
} from "./cache-policy"

const cases: Array<[string, string, "static" | "shell" | "deny"]> = [
  ["https://xiryn.example/", "GET", "shell"],
  ["https://xiryn.example/agents", "GET", "shell"],
  ["https://xiryn.example/routines", "GET", "shell"],
  ["https://xiryn.example/skills", "GET", "shell"],
  ["https://xiryn.example/templates", "GET", "shell"],
  ["https://xiryn.example/?_rsc=abc", "GET", "shell"],
  ["https://xiryn.example/icon-192.png", "GET", "static"],
  ["https://xiryn.example/startup/iphone-14.png", "GET", "static"],
  ["https://xiryn.example/_next/static/chunks/app.js", "GET", "static"],
  ["https://xiryn.example/manifest.webmanifest", "GET", "static"],
  ["https://xiryn.example/settings", "GET", "deny"],
  ["https://xiryn.example/settings#providers", "GET", "deny"],
  ["https://xiryn.example/usage", "GET", "deny"],
  ["https://xiryn.example/search", "GET", "deny"],
  ["https://xiryn.example/search?q=vault", "GET", "deny"],
  ["https://xiryn.example/a/agent/thread", "GET", "deny"],
  ["https://xiryn.example/s/squad/thread", "GET", "deny"],
  ["https://xiryn.example/api/health", "GET", "deny"],
  ["https://xiryn.example/api/events", "GET", "deny"],
  ["https://xiryn.example/api/uploads", "GET", "deny"],
  ["https://xiryn.example/api/uploads/agent/file", "GET", "deny"],
  ["https://xiryn.example/api/push", "GET", "deny"],
  ["https://xiryn.example/api/hooks/routines/id", "GET", "deny"],
  ["https://xiryn.example/api/google/oauth/start", "GET", "deny"],
  ["https://xiryn.example/api/threads/t/turn", "GET", "deny"],
  ["https://xiryn.example/sw.js", "GET", "deny"],
  ["https://xiryn.example/", "POST", "deny"],
  ["https://xiryn.example/?token=1", "GET", "deny"],
  ["https://user:pass@xiryn.example/", "GET", "deny"],
  ["https://xiryn.example/vault", "GET", "deny"],
  ["https://xiryn.example/../secrets", "GET", "deny"],
]

test("the cache allowlist stores the shell and icons, and nothing sensitive", () => {
  assert.deepEqual(CACHE_POLICY.apiReads, [])
  for (const [url, method, verdict] of cases) {
    assert.equal(decideCache(url, method, CACHE_POLICY), verdict, `${method} ${url}`)
  }
})

test("only a clean 200 is stored, and 401 drops the cache", () => {
  assert.equal(shouldStoreResponse(200, ["content-type"]), true)
  assert.equal(shouldStoreResponse(200, ["Cache-Control"]), true)
  assert.equal(shouldStoreResponse(200, ["Set-Cookie"]), false)
  assert.equal(shouldStoreResponse(200, ["WWW-Authenticate"]), false)
  assert.equal(shouldStoreResponse(200, ["Authorization"]), false)
  assert.equal(shouldStoreResponse(401, []), false)
  assert.equal(shouldStoreResponse(204, []), false)
  assert.equal(shouldStoreResponse(500, []), false)
  assert.equal(shouldClearCaches(401), true)
  assert.equal(shouldClearCaches(403), false)
  assert.equal(shouldClearCaches(200), false)
})

test("the worker script is the same allowlist and does not cache with credentials", () => {
  const source = serviceWorkerSource()
  assert.match(source, /function decideCache/)
  assert.ok(source.includes(JSON.stringify(CACHE_POLICY)))
  assert.match(source, /new Request\(url, \{ method: "GET" \}\)/)
  assert.match(source, /headers\.delete\("set-cookie"\)/)
  assert.match(source, /headers\.delete\("authorization"\)/)
  assert.doesNotMatch(source, /backgroundSync|sync\.register/i)
  assert.equal(source.includes("cache.addAll"), false)

  const listeners: Record<string, (event: unknown) => void> = {}
  const context = {
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    self: {
      location: { origin: "https://xiryn.example" },
      addEventListener(type: string, fn: (event: unknown) => void) {
        listeners[type] = fn
      },
      skipWaiting() {},
      clients: {
        matchAll: async () => [],
        claim: async () => {},
        openWindow: async () => {},
      },
      registration: { showNotification: async () => {} },
    },
  }
  vm.runInNewContext(`${source}\nglobalThis.__decide = decideCache\n`, context)
  const workerDecide = (context as unknown as { __decide: typeof decideCache }).__decide
  assert.equal(typeof workerDecide, "function")
  for (const [url, method, verdict] of cases) {
    assert.equal(
      workerDecide(url, method, CACHE_POLICY),
      verdict,
      `worker ${method} ${url}`
    )
  }
  assert.equal(typeof listeners.fetch, "function")
  assert.equal(typeof listeners.push, "function")
  assert.equal(typeof listeners.message, "function")
})
