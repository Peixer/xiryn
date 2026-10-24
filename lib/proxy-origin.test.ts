import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { NextRequest } from "next/server"

import { proxy } from "../proxy"

function call(
  url: string,
  method: string,
  headers?: Record<string, string>,
  host?: string
) {
  // NextRequest does not copy the URL host into the Host header, and the
  // proxy decides from that header, the same way a real request arrives.
  return proxy(
    new NextRequest(url, {
      method,
      headers: { host: host ?? new URL(url).host, ...headers },
    })
  )
}

function textOf(response: Response) {
  return response.text()
}

test("GET and SSE stay open on an allowed host without Origin", async () => {
  const page = call("http://127.0.0.1:6796/settings", "GET")
  assert.notEqual(page.status, 403)

  const sse = call("http://127.0.0.1:6796/api/events", "GET", {
    accept: "text/event-stream",
  })
  assert.notEqual(sse.status, 403)

  const head = call("http://localhost:6796/", "HEAD")
  assert.notEqual(head.status, 403)

  const sseWithOrigin = call("http://127.0.0.1:6796/api/events", "GET", {
    accept: "text/event-stream",
    origin: "http://127.0.0.1:6796",
  })
  assert.notEqual(sseWithOrigin.status, 403)
})

test("state-changing requests need an Origin on an allowed host", async () => {
  const missing = call("http://127.0.0.1:6796/", "POST")
  assert.equal(missing.status, 403)
  assert.match(await textOf(missing), /Origin/i)

  const bad = call("http://127.0.0.1:6796/", "POST", {
    origin: "https://evil.example",
  })
  assert.equal(bad.status, 403)
  assert.match(await textOf(bad), /Cross-origin/)

  const same = call("http://127.0.0.1:6796/", "POST", {
    origin: "http://127.0.0.1:6796",
  })
  assert.notEqual(same.status, 403)

  const localhostOrigin = call("http://127.0.0.1:6796/", "POST", {
    origin: "http://localhost:6796",
  })
  assert.equal(localhostOrigin.status, 403)
  assert.match(await textOf(localhostOrigin), /Cross-origin/)

  const otherPort = call("http://127.0.0.1:6796/api/threads/t/turn", "POST", {
    origin: "http://127.0.0.1:3000",
  })
  assert.equal(otherPort.status, 403)

  const decimal = call("http://127.0.0.1:6796/", "POST", {
    origin: "http://2130706433:6796",
  })
  assert.equal(decimal.status, 403)

  const shortIp = call("http://127.0.0.1:6796/", "POST", {
    origin: "http://127.1:6796",
  })
  assert.equal(shortIp.status, 403)

  const userinfo = call("http://127.0.0.1:6796/", "POST", {
    origin: "http://evil.com@127.0.0.1:6796",
  })
  assert.equal(userinfo.status, 403)

  const remove = call("http://127.0.0.1:6796/api/threads/t/turn", "DELETE")
  assert.equal(remove.status, 403)

  const removeSame = call("http://127.0.0.1:6796/api/threads/t/turn", "DELETE", {
    origin: "http://127.0.0.1:6796",
  })
  assert.notEqual(removeSame.status, 403)

  const ipv6 = call("http://[::1]:6796/", "POST", { origin: "http://[::1]:6796" })
  assert.notEqual(ipv6.status, 403)

  const nullOrigin = call("http://localhost:6796/", "POST", { origin: "null" })
  assert.equal(nullOrigin.status, 403)
})

test("XIRYN_ALLOWED_HOSTS still admits that https host, and a bad Host is refused", async () => {
  const previous = process.env.XIRYN_ALLOWED_HOSTS
  process.env.XIRYN_ALLOWED_HOSTS = "xiryn.example.com, other.example"
  try {
    const get = call("https://xiryn.example.com/settings", "GET")
    assert.notEqual(get.status, 403)

    const sse = call("https://xiryn.example.com/api/events", "GET", {
      accept: "text/event-stream",
    })
    assert.notEqual(sse.status, 403)

    const post = call("https://xiryn.example.com/", "POST", {
      origin: "https://xiryn.example.com",
    })
    assert.notEqual(post.status, 403)

    const withPort = call(
      "https://xiryn.example.com/",
      "POST",
      { origin: "https://xiryn.example.com" },
      "xiryn.example.com:443"
    )
    assert.notEqual(withPort.status, 403)

    const missingOrigin = call("https://xiryn.example.com/", "POST")
    assert.equal(missingOrigin.status, 403)

    const cross = call("https://xiryn.example.com/", "POST", {
      origin: "https://evil.example",
    })
    assert.equal(cross.status, 403)

    const other = call("https://other.example/api/events", "GET")
    assert.notEqual(other.status, 403)

    const lookalike = call("https://xiryn.example.com.evil/", "GET")
    assert.equal(lookalike.status, 403)
    assert.match(await textOf(lookalike), /localhost|XIRYN_ALLOWED_HOSTS/)
  } finally {
    if (previous === undefined) delete process.env.XIRYN_ALLOWED_HOSTS
    else process.env.XIRYN_ALLOWED_HOSTS = previous
  }

  const badHost = call("http://evil.example/", "GET")
  assert.equal(badHost.status, 403)

  const badHostPost = call("http://evil.example/", "POST", {
    origin: "http://evil.example",
  })
  assert.equal(badHostPost.status, 403)

  const ipv6 = call("http://[::1]:6796/", "GET")
  assert.notEqual(ipv6.status, 403)
})

test("uploads keep the Origin check, and the PWA manifest stays a normal GET", async () => {
  const upload = call("http://127.0.0.1:6796/api/uploads?agentId=agent_1", "POST", {
    origin: "http://127.0.0.1:6796",
    "content-type": "multipart/form-data; boundary=----x",
  })
  assert.notEqual(upload.status, 403)

  const uploadMissing = call("http://127.0.0.1:6796/api/uploads?agentId=agent_1", "POST")
  assert.equal(uploadMissing.status, 403)

  const uploadCross = call("http://127.0.0.1:6796/api/uploads?agentId=agent_1", "POST", {
    origin: "http://127.0.0.1:3000",
  })
  assert.equal(uploadCross.status, 403)

  const manifest = call("http://127.0.0.1:6796/manifest.webmanifest", "GET")
  assert.notEqual(manifest.status, 403)

  const manifestOrigin = call("http://127.0.0.1:6796/manifest.webmanifest", "GET", {
    origin: "http://127.0.0.1:6796",
  })
  assert.notEqual(manifestOrigin.status, 403)

  const icon = call("http://127.0.0.1:6796/icon-192.png", "GET")
  assert.notEqual(icon.status, 403)

  const foreignManifest = call("http://evil.example/manifest.webmanifest", "GET")
  assert.equal(foreignManifest.status, 403)

  const hook = call("http://127.0.0.1:6796/api/hooks/routines/routine_1", "POST")
  assert.notEqual(hook.status, 403)

  const hookCross = call("http://127.0.0.1:6796/api/hooks/routines/routine_1", "POST", {
    origin: "https://evil.example",
  })
  assert.equal(hookCross.status, 403)

  const hookForeign = call("http://evil.example/api/hooks/routines/routine_1", "POST")
  assert.equal(hookForeign.status, 403)
})

test("maintenance is read-only for writes and still refuses a foreign host", async () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-maint-")),
    "maintenance"
  )
  fs.writeFileSync(file, "read-only\n")
  const previous = process.env.XIRYN_MAINTENANCE_FILE
  process.env.XIRYN_MAINTENANCE_FILE = file
  try {
    const read = call("http://127.0.0.1:6796/api/health", "GET")
    assert.notEqual(read.status, 503)
    const write = call("http://127.0.0.1:6796/settings", "POST", {
      origin: "http://127.0.0.1:6796",
    })
    assert.equal(write.status, 503)
    const foreign = call("http://evil.example/settings", "POST", {
      origin: "http://evil.example",
    })
    assert.equal(foreign.status, 403)
  } finally {
    if (previous === undefined) delete process.env.XIRYN_MAINTENANCE_FILE
    else process.env.XIRYN_MAINTENANCE_FILE = previous
  }
})
