import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import type { AddressInfo } from "node:net"
import type { XirynEvent } from "@/lib/events"
import type { NotifyConfig } from "./notify-webhook"

// A throwaway database so reading settings never touches the user's data.
process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-notify-"))
process.env.XIRYN_DESKTOP_NOTIFY = "off"
delete process.env.XIRYN_NOTIFY_WEBHOOK_URL
delete process.env.XIRYN_NOTIFY_WEBHOOK_FORMAT
delete process.env.XIRYN_NOTIFY_WEBHOOK_TRIGGERS
delete process.env.XIRYN_NOTIFY_WEBHOOK_PREVIEW

const { sqlite } = await import("@/db")
const { threads } = await import("@/db/schema")
const { db } = await import("@/db")
const { describeSetting, setSetting } = await import("@/lib/config")
const { emit, foregroundListenerCount, subscribe } = await import("@/lib/events")
const notify = await import("./notify-webhook")

const {
  NOTIFY_MAX_ATTEMPTS,
  NOTIFY_TIMEOUT_MS,
  PREVIEW_MAX,
  assertWebhookUrl,
  clipPreview,
  deliverNotifyWebhook,
  mapNotifyPayload,
  startNotifyWebhook,
  triggerForEvent,
} = notify

after(() => {
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

const common = {
  threadId: "thread1",
  href: "/a/agent1/thread1",
  name: "Agent X",
  glyph: "glyph",
  via: "web" as const,
}

function finished(preview = "All done.", ok = true): XirynEvent {
  return {
    ...common,
    type: "turn-finished",
    preview,
    ok,
    durationMs: 1200,
    ...(ok ? {} : { error: "The model stopped." }),
  }
}

const cases: { event: XirynEvent; trigger: string; message: string }[] = [
  {
    event: finished(),
    trigger: "finished",
    message: "Agent X finished: Buy milk",
  },
  {
    event: finished("", false),
    trigger: "failed",
    message: "Agent X failed: Buy milk",
  },
  {
    event: { ...common, type: "payment", reason: "Wants to pay 12 to Shop" },
    trigger: "approval",
    message: "Agent X needs approval: Buy milk",
  },
  {
    event: { ...common, type: "action", reason: "Send the mail" },
    trigger: "approval",
    message: "Agent X needs approval: Buy milk",
  },
  {
    event: { ...common, type: "takeover", reason: "Log in to the shop" },
    trigger: "takeover",
    message: "Agent X needs takeover: Buy milk",
  },
  {
    event: { ...common, type: "secret", reason: "Need the postcode" },
    trigger: "secret",
    message: "Agent X needs a secret: Buy milk",
  },
]

function config(
  url: string | undefined,
  extras?: Partial<{
    format: "ntfy" | "slack" | "json"
    triggers: string
    preview: boolean
  }>
) {
  return {
    url,
    format: extras?.format ?? "json",
    triggers: new Set(
      (extras?.triggers ?? "finished,failed,approval,takeover,secret")
        .split(",")
        .filter(Boolean)
    ) as NotifyConfig["triggers"],
    preview: extras?.preview ?? false,
  }
}

test("mapper covers every format and event type", () => {
  assert.equal(triggerForEvent({ ...common, type: "turn-started" }), null)
  assert.equal(
    mapNotifyPayload({
      event: { ...common, type: "turn-started" },
      format: "json",
      title: "Buy milk",
      includePreview: true,
    }),
    null
  )

  for (const format of ["ntfy", "slack", "json"] as const) {
    for (const spec of cases) {
      const mapped = mapNotifyPayload({
        event: spec.event,
        format,
        title: "Buy milk",
        includePreview: false,
      })
      assert.ok(mapped)
      const serialized = `${mapped.headers["Content-Type"] ?? ""}\n${mapped.body}`
      assert.equal(serialized.includes("All done"), false)
      assert.equal(serialized.includes("Wants to pay"), false)
      if (format === "json") {
        const body = JSON.parse(mapped.body) as {
          message: string
          trigger: string
          type: string
          preview?: string
          ok?: boolean
        }
        assert.equal(body.message, spec.message)
        assert.equal(body.trigger, spec.trigger)
        assert.equal(body.type, spec.event.type)
        assert.equal(body.preview, undefined)
        assert.equal("url" in body, false)
        if (spec.event.type === "turn-finished") assert.equal(body.ok, spec.event.ok)
      } else if (format === "slack") {
        assert.deepEqual(JSON.parse(mapped.body), { text: spec.message })
        assert.equal(mapped.headers["Content-Type"], "application/json; charset=utf-8")
      } else {
        assert.equal(mapped.body, spec.message)
        assert.equal(mapped.headers["Content-Type"], "text/plain; charset=utf-8")
        assert.equal(mapped.headers.Title, "Xiryn")
        assert.equal(
          mapped.headers.Priority,
          spec.trigger === "finished" ? "default" : "high"
        )
      }
    }
  }
})

test("preview is off unless asked, and then capped at 140 characters", () => {
  const token = `PREVIEWTOKEN${"x".repeat(200)}`
  const event = finished(token)
  const off = mapNotifyPayload({
    event,
    format: "json",
    title: "Buy milk",
    includePreview: false,
  })
  assert.ok(off)
  assert.equal(off.body.includes("PREVIEWTOKEN"), false)
  assert.equal(JSON.parse(off.body).preview, undefined)

  const on = mapNotifyPayload({
    event,
    format: "json",
    title: "Buy milk",
    includePreview: true,
  })
  assert.ok(on)
  const preview = JSON.parse(on.body).preview as string
  assert.equal(preview.length, PREVIEW_MAX)
  assert.equal(preview.startsWith("PREVIEWTOKEN"), true)
  assert.equal(preview.endsWith("…"), true)
  assert.equal(clipPreview("x".repeat(PREVIEW_MAX)).length, PREVIEW_MAX)
  assert.equal(clipPreview("x".repeat(PREVIEW_MAX)).includes("…"), false)
  assert.equal(clipPreview("a   \n  b"), "a b")

  const slack = mapNotifyPayload({
    event: finished("short note"),
    format: "slack",
    title: "Buy milk",
    includePreview: true,
  })
  assert.deepEqual(JSON.parse(slack!.body), {
    text: "Agent X finished: Buy milk\nshort note",
  })

  const ntfy = mapNotifyPayload({
    event: { ...common, type: "secret", reason: "y".repeat(180) },
    format: "ntfy",
    title: "Buy milk",
    includePreview: true,
  })
  const lines = ntfy!.body.split("\n")
  assert.equal(lines[0], "Agent X needs a secret: Buy milk")
  assert.equal(lines[1].length, PREVIEW_MAX)

  const failed = mapNotifyPayload({
    event: finished("", false),
    format: "json",
    title: "Buy milk",
    includePreview: true,
  })
  assert.equal(JSON.parse(failed!.body).preview, "The model stopped.")
})

test("webhook URL must be http or https", () => {
  assert.doesNotThrow(() => assertWebhookUrl("https://example.com/hook"))
  assert.doesNotThrow(() => assertWebhookUrl(" http://127.0.0.1:8791/hook "))
  for (const value of [
    "ftp://example.com/hook",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "not a url",
    "",
    "http://",
    "https://",
  ]) {
    assert.throws(() => assertWebhookUrl(value), /http or https/)
  }
})

test("a failed delivery does not throw and does not log the URL", async () => {
  const secretUrl = "https://alerts.example/hook/super-secret-token"
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(" "))
  }
  try {
    let calls = 0
    await deliverNotifyWebhook(finished("private reply"), {
      config: config(secretUrl),
      title: "Buy milk",
      fetchImpl: async (_url, init) => {
        calls += 1
        assert.ok(init?.signal instanceof AbortSignal)
        throw new Error(`connect ${secretUrl} refused`, {
          cause: new Error(`dial ${secretUrl}`),
        })
      },
    })
    assert.equal(calls, NOTIFY_MAX_ATTEMPTS)

    calls = 0
    await deliverNotifyWebhook(finished(), {
      config: config(secretUrl),
      title: "Buy milk",
      fetchImpl: async () => {
        calls += 1
        return new Response("no", { status: 500 })
      },
    })
    assert.equal(calls, NOTIFY_MAX_ATTEMPTS)

    calls = 0
    await deliverNotifyWebhook(finished(), {
      config: config(secretUrl),
      title: "Buy milk",
      fetchImpl: async () => {
        calls += 1
        return new Response("no", { status: 404 })
      },
    })
    assert.equal(calls, 1)

    calls = 0
    await deliverNotifyWebhook(finished(), {
      config: config("ftp://alerts.example/super-secret-token"),
      title: "Buy milk",
      fetchImpl: async () => {
        calls += 1
        return new Response(null, { status: 204 })
      },
    })
    assert.equal(calls, 0)

    calls = 0
    await deliverNotifyWebhook(finished(), {
      config: config(undefined),
      title: "Buy milk",
      fetchImpl: async () => {
        calls += 1
        return new Response(null, { status: 204 })
      },
    })
    assert.equal(calls, 0)

    calls = 0
    await deliverNotifyWebhook(
      { ...common, type: "turn-started" },
      {
        config: config(secretUrl),
        title: "Buy milk",
        fetchImpl: async () => {
          calls += 1
          return new Response(null, { status: 204 })
        },
      }
    )
    assert.equal(calls, 0)

    calls = 0
    await deliverNotifyWebhook(finished(), {
      config: config(secretUrl, { triggers: "failed" }),
      title: "Buy milk",
      fetchImpl: async () => {
        calls += 1
        return new Response(null, { status: 204 })
      },
    })
    assert.equal(calls, 0)
  } finally {
    console.error = original
  }

  assert.ok(lines.length >= 1)
  const logged = lines.join("\n")
  assert.equal(logged.includes(secretUrl), false)
  assert.equal(logged.includes("super-secret-token"), false)
  assert.equal(logged.includes("alerts.example"), false)
  assert.equal(logged.includes("private reply"), false)
  assert.match(logged, /notify webhook failed/)
  assert.equal(NOTIFY_TIMEOUT_MS, 5_000)
})

test("a background subscription is not an open tab", () => {
  const before = foregroundListenerCount()
  startNotifyWebhook()
  startNotifyWebhook()
  assert.equal(foregroundListenerCount(), before)
  const stop = subscribe(() => {})
  assert.equal(foregroundListenerCount(), before + 1)
  stop()
  assert.equal(foregroundListenerCount(), before)
})

test("a finished turn posts once, and disabling stops it", async () => {
  const hits: { body: string }[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      hits.push({ body: Buffer.concat(chunks).toString("utf8") })
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address() as AddressInfo
  const url = `http://127.0.0.1:${address.port}/hook`
  const preview = "PRIVATE_REPLY_TEXT"
  try {
    let calls = 0
    await deliverNotifyWebhook(finished(preview), {
      title: "Buy milk",
      fetchImpl: async () => {
        calls += 1
        return new Response(null, { status: 204 })
      },
    })
    assert.equal(calls, 0)

    const [thread] = db.insert(threads).values({ title: "Buy milk" }).returning().all()
    setSetting("notify.webhookUrl", url)
    setSetting("notify.webhookFormat", "json")
    setSetting("notify.webhookTriggers", "finished,failed")
    setSetting("notify.webhookPreview", "off")
    const masked = describeSetting("notify.webhookUrl")
    assert.notEqual(masked.value, url)
    assert.equal(masked.value?.includes(String(address.port)), false)

    startNotifyWebhook()
    const event: XirynEvent = {
      ...finished(preview),
      threadId: thread.id,
      href: `/a/agent/${thread.id}`,
    }
    emit(event)
    await waitForHits(hits, 1)
    assert.equal(hits.length, 1)
    const body = JSON.parse(hits[0].body) as { message: string; preview?: string }
    assert.equal(body.message, "Agent X finished: Buy milk")
    assert.equal(body.preview, undefined)
    assert.equal(hits[0].body.includes(preview), false)
    assert.equal(hits[0].body.includes(url), false)

    emit(event)
    await waitForHits(hits, 2)
    assert.equal(hits.length, 2)

    setSetting("notify.webhookUrl", null)
    emit(event)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(hits.length, 2)

    setSetting("notify.webhookUrl", url)
    setSetting("notify.webhookTriggers", "none")
    emit(event)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(hits.length, 2)
  } finally {
    setSetting("notify.webhookUrl", null)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

async function waitForHits(hits: unknown[], count: number) {
  const start = Date.now()
  while (hits.length < count) {
    if (Date.now() - start > 2000) {
      throw new Error(`expected ${count} webhook posts`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
