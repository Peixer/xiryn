import assert from "node:assert/strict"
import { test } from "node:test"

import { approvalArgsHash } from "@/lib/mcp/approval-preview"
import { canonicalArgs } from "@/lib/mcp/policy"

import type { HelperRequest } from "./allowlist"
import { runPrepare, runRollback, runSwitch, type Host } from "./helper"
import { DEFAULT_LAYOUT } from "./layout"
import { initialState, type DeployState } from "./state"

const TIP = "b".repeat(40)
const ACTIVE = "a".repeat(40)

function request(over: Partial<HelperRequest>): HelperRequest {
  return {
    op: "prepare",
    sha: TIP,
    approvalId: null,
    actor: "owner",
    requestedAt: "2026-10-24T08:00:00.000Z",
    ...over,
  }
}

function harness(start: DeployState, behaviour: Partial<Host> = {}) {
  let state = start
  const calls: string[] = []
  const host: Host = {
    now: () => Date.parse("2026-10-24T08:00:00.000Z"),
    readState: () => state,
    writeState: (next) => {
      state = next
    },
    progress: () => {},
    audit: () => {},
    layout: () => DEFAULT_LAYOUT,
    fetchTip: () => TIP,
    syncCheckout: () => calls.push("checkout"),
    installAndBuild: () => calls.push("build"),
    snapshotDb: () => calls.push("snapshot"),
    migrate: () => ({ journalCount: 10, appliedCount: 10 }),
    startColour: (colour) => calls.push(`start:${colour}`),
    stopColour: (colour) => calls.push(`stop:${colour}`),
    pause: () => {},
    health: () => ({ ok: true, status: "ok" }),
    smoke: () => ({ ok: true, detail: "ok" }),
    setMaintenance: (on) => calls.push(on ? "maintenance-on" : "maintenance-off"),
    pointCaddy: (colour) => calls.push(`caddy:${colour}`),
    reloadCaddy: () => calls.push("reload"),
    restoreCaddy: () => calls.push("restore"),
    backup: () => calls.push("backup"),
    readApproval: () => null,
    takeApproval: (id) => {
      const read = behaviour.readApproval ?? (() => null)
      const row = read(id)
      if (!row || row.status !== "approved") return null
      return row
    },
    writeRelease: () => {},
    changelog: () => ({
      titles: ["Fix the journal"],
      migrations: ["db/migrations/0009_subturn_fk_schema_fix.sql"],
    }),
    ...behaviour,
  }
  return {
    host,
    calls,
    state: () => state,
  }
}

test("prepare refuses a commit that is not the branch tip and never builds", () => {
  const box = harness(initialState({ activeSha: ACTIVE }))
  const result = runPrepare(box.host, request({ sha: "c".repeat(40) }))
  assert.equal(result.ok, false)
  assert.deepEqual(box.calls, [])
  assert.equal(box.state().phase, "idle")
})

test("prepare does not become ready when migrations were skipped", () => {
  const box = harness(initialState({ activeSha: ACTIVE }), {
    migrate: () => ({ journalCount: 10, appliedCount: 9 }),
  })
  const result = runPrepare(box.host, request({}))
  assert.equal(result.ok, false)
  assert.equal(box.calls.includes("start"), false)
  assert.equal(box.state().phase, "idle")
  assert.match(box.state().error ?? "", /Refusing to switch|did not apply/)
})

test("a used approval cannot switch again inside the window", () => {
  const args = {
    op: "switch" as const,
    sha: TIP,
    from: "blue" as const,
    to: "green" as const,
    branch: "main",
  }
  const box = harness(
    initialState({
      phase: "ready",
      activeSha: ACTIVE,
      candidate: "green",
      candidateSha: TIP,
      branch: "main",
    }),
    {
      readApproval: () => ({
        tool: "request_self_update",
        args: canonicalArgs(args),
        argsHash: approvalArgsHash(args),
        status: "used",
        expiresAt: Date.parse("2026-10-24T09:00:00.000Z"),
      }),
    }
  )
  const result = runSwitch(
    box.host,
    request({ op: "switch", sha: TIP, approvalId: "approval123" })
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /already used/)
  assert.equal(box.calls.includes("caddy:green"), false)
  assert.equal(box.state().phase, "ready")
})

test("switch without an approval does not touch Caddy", () => {
  const box = harness(
    initialState({
      phase: "ready",
      activeSha: ACTIVE,
      candidate: "green",
      candidateSha: TIP,
    })
  )
  const result = runSwitch(
    box.host,
    request({ op: "switch", sha: TIP, approvalId: "approval123" })
  )
  assert.equal(result.ok, false)
  assert.equal(box.calls.includes("reload"), false)
  assert.equal(box.state().phase, "ready")
})

test("a failed post-switch health check restores the proxy", () => {
  const args = {
    op: "switch" as const,
    sha: TIP,
    from: "blue" as const,
    to: "green" as const,
    branch: "main",
  }
  const box = harness(
    initialState({
      phase: "ready",
      activeSha: ACTIVE,
      candidate: "green",
      candidateSha: TIP,
      branch: "main",
    }),
    {
      health: () => ({ ok: false, status: "down" }),
      readApproval: () => ({
        tool: "request_self_update",
        args: canonicalArgs(args),
        argsHash: approvalArgsHash(args),
        status: "approved",
        expiresAt: Date.parse("2026-10-24T09:00:00.000Z"),
      }),
    }
  )
  const result = runSwitch(
    box.host,
    request({ op: "switch", sha: TIP, approvalId: "approval123" })
  )
  assert.equal(result.ok, false)
  assert.equal(box.calls.includes("caddy:green"), true)
  assert.equal(box.calls.includes("restore"), true)
  assert.equal(box.state().phase, "rolled_back")
  assert.equal(box.state().active, "blue")
  assert.equal(box.state().maintenance, false)
  assert.equal(
    box.calls.some((call) => call.startsWith("stop:")),
    false
  )
})

test("an approved switch leaves the previous colour recorded for rollback", () => {
  const args = {
    op: "switch" as const,
    sha: TIP,
    from: "blue" as const,
    to: "green" as const,
    branch: "main",
  }
  const box = harness(
    initialState({
      phase: "ready",
      activeSha: ACTIVE,
      candidate: "green",
      candidateSha: TIP,
      branch: "main",
    }),
    {
      readApproval: () => ({
        tool: "request_self_update",
        args: canonicalArgs(args),
        argsHash: approvalArgsHash(args),
        status: "approved",
        expiresAt: Date.parse("2026-10-24T09:00:00.000Z"),
      }),
    }
  )
  const result = runSwitch(
    box.host,
    request({ op: "switch", sha: TIP, approvalId: "approval123" })
  )
  assert.equal(result.ok, true)
  assert.equal(box.state().phase, "active")
  assert.equal(box.state().active, "green")
  assert.equal(box.state().previous, "blue")
  const stopped = box.calls.indexOf("stop:blue")
  const opened = box.calls.lastIndexOf("maintenance-off")
  assert.ok(stopped >= 0 && stopped < opened)
  assert.equal(box.calls.includes("stop:green"), false)
})

function approvedRollback() {
  const args = {
    op: "rollback" as const,
    sha: ACTIVE,
    from: "green" as const,
    to: "blue" as const,
    branch: "main",
  }
  return {
    tool: "request_self_update",
    args: canonicalArgs(args),
    argsHash: approvalArgsHash(args),
    status: "approved",
    expiresAt: Date.parse("2026-10-24T09:00:00.000Z"),
  }
}

test("rollback starts a stopped previous colour and then stops the one it leaves", () => {
  let up = false
  const box = harness(
    initialState({
      phase: "active",
      baseline: "active",
      active: "green",
      activeSha: TIP,
      previous: "blue",
      previousSha: ACTIVE,
      branch: "main",
    }),
    {
      health: () => ({ ok: up, status: up ? "ok" : "down" }),
      startColour: () => {
        up = true
        box.calls.push("start:blue")
      },
      readApproval: () => approvedRollback(),
    }
  )
  const result = runRollback(
    box.host,
    request({ op: "rollback", sha: ACTIVE, approvalId: "approval123" })
  )
  assert.equal(result.ok, true)
  assert.equal(box.state().active, "blue")
  const start = box.calls.indexOf("start:blue")
  const caddy = box.calls.indexOf("caddy:blue")
  const stop = box.calls.indexOf("stop:green")
  const opened = box.calls.lastIndexOf("maintenance-off")
  assert.ok(start >= 0 && start < caddy && caddy < stop && stop < opened)
})

test("a failed rollback stops a colour it had to start", () => {
  const box = harness(
    initialState({
      phase: "active",
      baseline: "active",
      active: "green",
      activeSha: TIP,
      previous: "blue",
      previousSha: ACTIVE,
      branch: "main",
    }),
    {
      health: () => ({ ok: false, status: "down" }),
      readApproval: () => approvedRollback(),
    }
  )
  const result = runRollback(
    box.host,
    request({ op: "rollback", sha: ACTIVE, approvalId: "approval123" })
  )
  assert.equal(result.ok, false)
  assert.equal(box.state().active, "green")
  assert.equal(box.calls.includes("start:blue"), true)
  assert.equal(box.calls.includes("stop:blue"), true)
  assert.equal(box.calls.includes("stop:green"), false)
  assert.equal(box.state().maintenance, false)
})

test("rollback is refused without approval", () => {
  const box = harness(
    initialState({
      phase: "active",
      baseline: "active",
      active: "green",
      activeSha: TIP,
      previous: "blue",
      previousSha: ACTIVE,
    })
  )
  const result = runRollback(
    box.host,
    request({ op: "rollback", sha: ACTIVE, approvalId: "approval123" })
  )
  assert.equal(result.ok, false)
  assert.equal(box.state().active, "green")
})

test("switch refuses a final snapshot whose migrations were skipped", () => {
  const args = {
    op: "switch" as const,
    sha: TIP,
    from: "blue" as const,
    to: "green" as const,
    branch: "main",
  }
  const box = harness(
    initialState({
      phase: "ready",
      activeSha: ACTIVE,
      candidate: "green",
      candidateSha: TIP,
      branch: "main",
    }),
    {
      migrate: () => ({ journalCount: 10, appliedCount: 8 }),
      readApproval: () => ({
        tool: "request_self_update",
        args: canonicalArgs(args),
        argsHash: approvalArgsHash(args),
        status: "approved",
        expiresAt: Date.parse("2026-10-24T09:00:00.000Z"),
      }),
    }
  )
  const result = runSwitch(
    box.host,
    request({ op: "switch", sha: TIP, approvalId: "approval123" })
  )
  assert.equal(result.ok, false)
  assert.equal(box.calls.includes("caddy:green"), false)
  assert.equal(box.state().phase, "ready")
  assert.equal(box.state().active, "blue")
})
