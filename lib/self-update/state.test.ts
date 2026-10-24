import assert from "node:assert/strict"
import { test } from "node:test"

import { initialState, TransitionError, transition } from "./state"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)

test("prepare, build, switch, and roll back walk the documented phases", () => {
  let state = initialState({ activeSha: SHA_A, branch: "main" })
  assert.equal(state.phase, "idle")

  state = transition(state, { type: "prepare", sha: SHA_B })
  assert.equal(state.phase, "building")
  assert.equal(state.candidate, "green")
  assert.equal(state.candidateSha, SHA_B)

  state = transition(state, { type: "build_ok" })
  assert.equal(state.phase, "ready")

  state = transition(state, { type: "switch_begin" })
  assert.equal(state.phase, "switching")
  assert.equal(state.maintenance, true)
  assert.equal(state.active, "blue")

  state = transition(state, { type: "switch_ok" })
  assert.equal(state.phase, "active")
  assert.equal(state.active, "green")
  assert.equal(state.activeSha, SHA_B)
  assert.equal(state.previous, "blue")
  assert.equal(state.previousSha, SHA_A)
  assert.equal(state.maintenance, false)
  assert.equal(state.candidate, null)

  state = transition(state, { type: "rollback_begin" })
  assert.equal(state.phase, "switching")
  state = transition(state, { type: "rollback_ok" })
  assert.equal(state.phase, "rolled_back")
  assert.equal(state.active, "blue")
  assert.equal(state.activeSha, SHA_A)
  assert.equal(state.candidate, "green")
  assert.equal(state.candidateSha, SHA_B)
})

test("a failed health check after switch lands on rolled_back without changing colour", () => {
  let state = transition(initialState({ activeSha: SHA_A }), {
    type: "prepare",
    sha: SHA_B,
  })
  state = transition(state, { type: "build_ok" })
  state = transition(state, { type: "switch_begin" })
  state = transition(state, { type: "switch_fail", error: "health" })
  assert.equal(state.phase, "rolled_back")
  assert.equal(state.active, "blue")
  assert.equal(state.candidate, "green")
  assert.equal(state.maintenance, false)
  assert.equal(state.error, "health")
})

test("a failed build returns to the phase it started from", () => {
  const active = initialState({ phase: "active", baseline: "active", activeSha: SHA_A })
  const building = transition(active, { type: "prepare", sha: SHA_B })
  const failed = transition(building, { type: "build_fail", error: "npm" })
  assert.equal(failed.phase, "active")
  assert.equal(failed.candidate, null)
  assert.equal(failed.error, "npm")
})

test("switch and rollback are refused from the wrong phase", () => {
  const idle = initialState()
  assert.throws(() => transition(idle, { type: "switch_begin" }), TransitionError)
  assert.throws(() => transition(idle, { type: "rollback_begin" }), TransitionError)
  assert.throws(() => transition(idle, { type: "prepare", sha: "main" }), TransitionError)
  assert.throws(
    () =>
      transition(transition(idle, { type: "prepare", sha: SHA_B }), {
        type: "prepare",
        sha: SHA_A,
      }),
    TransitionError
  )
})

test("aborting a switch before the proxy moves returns to ready", () => {
  let state = transition(initialState({ activeSha: SHA_A }), {
    type: "prepare",
    sha: SHA_B,
  })
  state = transition(state, { type: "build_ok" })
  state = transition(state, { type: "switch_begin" })
  state = transition(state, { type: "switch_abort", error: "skipped" })
  assert.equal(state.phase, "ready")
  assert.equal(state.active, "blue")
  assert.equal(state.maintenance, false)
})
