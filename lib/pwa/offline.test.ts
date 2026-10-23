import assert from "node:assert/strict"
import { test } from "node:test"

import { isNetworkFailure, presence, shouldFlushOutbox } from "./offline"

test("offline is only an explicit false from the browser", () => {
  assert.equal(presence(false), "offline")
  assert.equal(presence(true), "online")
  assert.equal(presence(undefined), "online")
})

test("the outbox flushes on start, reconnect and visibility, never background sync", () => {
  assert.equal(shouldFlushOutbox({ reason: "start", online: true }), true)
  assert.equal(shouldFlushOutbox({ reason: "online", online: true }), true)
  assert.equal(shouldFlushOutbox({ reason: "visible", online: true }), true)
  assert.equal(shouldFlushOutbox({ reason: "visible", online: false }), false)
  assert.equal(shouldFlushOutbox({ reason: "start", online: false }), false)
  assert.equal(shouldFlushOutbox({ reason: "background-sync", online: true }), false)
})

test("a failed fetch while the browser still says online is a network failure", () => {
  assert.equal(isNetworkFailure(new TypeError("Failed to fetch"), true), true)
  assert.equal(isNetworkFailure(new Error("Load failed"), true), true)
  assert.equal(isNetworkFailure(new Error("network error"), true), true)
  assert.equal(isNetworkFailure(new Error("Malformed message."), true), false)
  assert.equal(isNetworkFailure(new Error("Malformed message."), false), true)
})
