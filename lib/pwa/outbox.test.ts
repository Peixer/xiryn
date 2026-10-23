import assert from "node:assert/strict"
import { test } from "node:test"

import {
  flushOutbox,
  isFlushable,
  outboxError,
  transition,
  type OutboxState,
} from "./outbox"

test("outbox moves queued to sending to sent", () => {
  assert.equal(transition("queued", { type: "enqueue" }), "queued")
  assert.equal(transition("queued", { type: "start" }), "sending")
  assert.equal(transition("sending", { type: "ack" }), "sent")
  assert.equal(transition("sent", { type: "start" }), "sent")
  assert.equal(transition("sent", { type: "ack" }), "sent")
  assert.equal(isFlushable("queued"), true)
  assert.equal(isFlushable("failed"), true)
  assert.equal(isFlushable("sending"), false)
  assert.equal(isFlushable("sent"), false)
})

test("a drop while offline stays queued, and an HTTP failure can be retried", () => {
  assert.equal(transition("sending", { type: "fail", online: false }), "queued")
  assert.equal(transition("sending", { type: "fail", online: true }), "failed")
  assert.equal(transition("failed", { type: "retry" }), "queued")
  assert.equal(transition("queued", { type: "fail", online: true }), "queued")
  assert.equal(outboxError({ ok: false, network: true }), "Waiting for a connection.")
  assert.equal(
    outboxError({ ok: false, network: false, status: 401 }),
    "Sign in again to send this."
  )
  assert.equal(
    outboxError({ ok: false, network: false, status: 500 }),
    "Couldn't send (500)."
  )
})

test("flush sends queued and failed messages and records each state", async () => {
  const seen: Array<[string, OutboxState]> = []
  const items: Array<{ id: string; state: OutboxState }> = [
    { id: "a", state: "queued" },
    { id: "b", state: "failed" },
    { id: "c", state: "sent" },
    { id: "d", state: "sending" },
  ]
  await flushOutbox(
    items,
    true,
    async (item) => {
      if (item.id === "b") return { ok: false, network: false, status: 500 }
      return { ok: true }
    },
    (item, state) => seen.push([item.id, state])
  )
  assert.deepEqual(seen, [
    ["a", "sending"],
    ["a", "sent"],
    ["b", "sending"],
    ["b", "failed"],
  ])

  const offline: Array<[string, OutboxState]> = []
  await flushOutbox(
    items,
    false,
    async () => ({ ok: true }),
    (item, state) => offline.push([item.id, state])
  )
  assert.deepEqual(offline, [])
})

test("a network error during flush returns the message to the queue", async () => {
  const seen: OutboxState[] = []
  await flushOutbox(
    [{ id: "a", state: "queued" }],
    true,
    async () => {
      throw new TypeError("Failed to fetch")
    },
    (_item, state) => seen.push(state)
  )
  assert.deepEqual(seen, ["sending", "queued"])
})
