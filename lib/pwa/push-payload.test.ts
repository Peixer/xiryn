import assert from "node:assert/strict"
import { test } from "node:test"

import type { XirynEvent } from "@/lib/events"

import { pushNotice } from "./push-payload"

const base = {
  threadId: "thread-1",
  href: "/a/agent/thread-1",
  name: "Atlas",
  glyph: "atlas",
  via: "web" as const,
}

test("push notices skip turn-started and strip credentials", () => {
  assert.equal(pushNotice({ ...base, type: "turn-started" }), null)
  const finished = pushNotice({
    ...base,
    type: "turn-finished",
    ok: true,
    preview: "Done. Bearer abc.def.ghi",
    durationMs: 10,
  })
  assert.equal(finished?.title, "Atlas finished")
  assert.equal(finished?.body.includes("abc.def"), false)
  assert.equal(finished?.href, "/a/agent/thread-1")
  assert.equal(finished?.tag, "thread-1")

  const approval = pushNotice({
    ...base,
    type: "action",
    reason: "run rm",
    href: "/a/agent/thread-1?takeover=1",
  })
  assert.equal(approval?.title, "Atlas wants approval")
  assert.equal(approval?.href, "/a/agent/thread-1")

  const secret = pushNotice({
    ...base,
    type: "secret",
    reason: "need a login",
    href: "/settings?token=1",
  })
  assert.equal(secret?.href, "/")
  assert.equal(secret?.body.includes("token"), false)

  const bad = pushNotice({
    ...base,
    type: "payment",
    reason: "pay",
    href: "https://evil.example/phish",
  } as XirynEvent)
  assert.equal(bad?.href, "/")
})
