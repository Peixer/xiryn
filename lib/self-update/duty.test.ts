import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { followDuty, processRole, workersWanted } from "./duty"

const state = (active: "blue" | "green") =>
  JSON.stringify({
    phase: "active",
    active,
    activeSha: "a".repeat(40),
    previous: null,
    previousSha: null,
    candidate: null,
    candidateSha: null,
    branch: "main",
    error: null,
    maintenance: false,
    baseline: "active",
    operation: null,
  })

function waitFor(predicate: () => boolean, ms = 2_000) {
  const start = Date.now()
  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - start > ms) {
        clearInterval(timer)
        reject(new Error("timed out"))
      }
    }, 15)
  })
}

test("a single install runs workers and a colour runs them only while it is active", () => {
  assert.equal(
    workersWanted(
      { role: { kind: "solo" }, active: "missing", maintenance: false },
      false
    ),
    true
  )
  assert.equal(
    workersWanted(
      { role: { kind: "solo" }, active: "missing", maintenance: true },
      false
    ),
    false
  )
  assert.equal(
    workersWanted(
      {
        role: { kind: "colour", colour: "green" },
        active: "missing",
        maintenance: false,
      },
      false
    ),
    false
  )
  assert.equal(
    workersWanted(
      { role: { kind: "colour", colour: "blue" }, active: "blue", maintenance: false },
      false
    ),
    true
  )
  assert.equal(
    workersWanted(
      { role: { kind: "colour", colour: "green" }, active: "blue", maintenance: false },
      false
    ),
    false
  )
  assert.equal(
    workersWanted(
      { role: { kind: "colour", colour: "blue" }, active: "blue", maintenance: true },
      true
    ),
    false
  )
  assert.equal(
    workersWanted(
      {
        role: { kind: "colour", colour: "blue" },
        active: "unreadable",
        maintenance: false,
      },
      true
    ),
    true
  )
  assert.equal(processRole({ XIRYN_COLOUR: "green" }).kind, "colour")
  assert.equal(
    processRole({ XIRYN_DATA_DIR: "/var/lib/xiryn/colours/blue" }).kind,
    "colour"
  )
  assert.equal(processRole({ XIRYN_COLOUR: "nope" }).kind, "invalid")
  assert.equal(processRole({ XIRYN_DATA_DIR: "/tmp/dev" }).kind, "solo")
})

test("only the active colour runs workers, including across a switch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-duty-"))
  const stateFile = path.join(dir, "state.json")
  const maintenanceFile = path.join(dir, "maintenance")
  fs.writeFileSync(stateFile, state("blue"))
  let blueOn = false
  let greenOn = false
  let overlap = false
  const note = () => {
    if (blueOn && greenOn) overlap = true
  }
  const options = {
    stateFile,
    maintenanceFile,
    intervalMs: 30,
    staleMs: 400,
  }
  const blue = followDuty(
    {
      start() {
        blueOn = true
        note()
      },
      stop() {
        blueOn = false
        note()
      },
    },
    { ...options, env: { XIRYN_COLOUR: "blue" } }
  )
  const green = followDuty(
    {
      start() {
        greenOn = true
        note()
      },
      stop() {
        greenOn = false
        note()
      },
    },
    { ...options, env: { XIRYN_COLOUR: "green" } }
  )
  try {
    await waitFor(() => blueOn && !greenOn)
    fs.writeFileSync(maintenanceFile, "read-only\n")
    await waitFor(() => !blueOn && !greenOn)
    fs.writeFileSync(stateFile, state("green"))
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(blueOn, false)
    assert.equal(greenOn, false)
    fs.rmSync(maintenanceFile)
    await waitFor(() => greenOn && !blueOn)
    fs.writeFileSync(stateFile, state("blue"))
    await waitFor(() => blueOn && !greenOn)
    assert.equal(overlap, false)
  } finally {
    blue.close()
    green.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
