import assert from "node:assert/strict"
import { test } from "node:test"

import { opAllowed } from "@/lib/self-update/submit"
import { initialState, type DeployState } from "@/lib/self-update/state"

test("status op is allowed in any phase", () => {
  const phases = ["idle", "building", "ready", "switching", "active", "rolled_back"]
  for (const phase of phases) {
    const state = { ...initialState(), phase } as DeployState
    const result = opAllowed(state, "status")
    assert.deepEqual(result, { ok: true }, `status should be allowed in phase ${phase}`)
  }
})

test("status op is allowed even during building or switching", () => {
  const building = { ...initialState(), phase: "building" } as DeployState
  const switching = { ...initialState(), phase: "switching" } as DeployState

  assert.deepEqual(opAllowed(building, "status"), { ok: true })
  assert.deepEqual(opAllowed(switching, "status"), { ok: true })
})

test("prepare op is blocked during building or switching", () => {
  const building = { ...initialState(), phase: "building" } as DeployState
  const switching = { ...initialState(), phase: "switching" } as DeployState

  const buildingResult = opAllowed(building, "prepare")
  const switchingResult = opAllowed(switching, "prepare")

  assert.equal(buildingResult.ok, false)
  assert.equal(switchingResult.ok, false)
})
