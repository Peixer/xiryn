import {
  gateSelfUpdate,
  publicOp,
  type GateApproval,
  type SelfUpdateArgs,
} from "@/lib/self-update/approval-gate"
import type { AuditEntry } from "@/lib/self-update/audit"
import { migrationGap } from "@/lib/self-update/migrations"
import { validatePinnedSha } from "@/lib/self-update/sha"
import { colourPort, type Layout } from "@/lib/self-update/layout"
import {
  initialState,
  transition,
  type Colour,
  type DeployState,
} from "@/lib/self-update/state"
import type { HelperRequest } from "@/lib/self-update/allowlist"
import { redactError } from "@/lib/self-update/redact"

export type MigrateReport = { journalCount: number; appliedCount: number }

export type ApprovalRow = {
  tool: string
  args: string
  argsHash: string
  status: string
  expiresAt: number | null
}

export type Host = {
  now(): number
  readState(): DeployState
  writeState(state: DeployState): void
  progress(step: string, message: string): void
  audit(entry: Omit<AuditEntry, "ts"> & { ts?: string }): void
  layout(): Layout
  fetchTip(): string
  syncCheckout(dir: string, sha: string): void
  installAndBuild(dir: string): void
  snapshotDb(from: Colour, to: Colour): void
  migrate(colour: Colour): MigrateReport
  startColour(colour: Colour): void
  stopColour(colour: Colour): void
  health(colour: Colour): { ok: boolean; status: string }
  smoke(colour: Colour): { ok: boolean; detail: string }
  setMaintenance(on: boolean): void
  pointCaddy(active: Colour): void
  reloadCaddy(): void
  restoreCaddy(): void
  backup(label: string): void
  readApproval(id: string): ApprovalRow | null
  writeRelease(release: {
    branch: string
    tipSha: string
    titles: string[]
    migrations: string[]
  }): void
  changelog(from: string | null, to: string): { titles: string[]; migrations: string[] }
}

function note(host: Host, step: string, message: string) {
  host.progress(step, message)
}

function record(
  host: Host,
  state: DeployState,
  entry: Omit<AuditEntry, "ts" | "active" | "candidate"> & {
    active?: Colour | null
    candidate?: Colour | null
  }
) {
  host.audit({
    ...entry,
    active: entry.active === undefined ? state.active : entry.active,
    candidate: entry.candidate === undefined ? state.candidate : entry.candidate,
    ts: new Date(host.now()).toISOString(),
  })
}

function argsFor(
  request: HelperRequest,
  state: DeployState,
  sha: string
): SelfUpdateArgs {
  const to =
    request.op === "rollback"
      ? state.previous
      : request.op === "switch"
        ? state.candidate
        : state.candidate
  return {
    op: publicOp(request.op === "status" ? "prepare" : request.op),
    sha,
    from: state.active,
    to: (to ?? state.active) as Colour,
    branch: state.branch,
  }
}

function approvalOf(row: ApprovalRow | null): GateApproval | null {
  if (!row) return null
  return {
    tool: row.tool,
    args: row.args,
    argsHash: row.argsHash,
    status: row.status,
    expiresAt: row.expiresAt,
  }
}

function failBuild(host: Host, state: DeployState, error: string) {
  const next = transition(state.phase === "building" ? state : host.readState(), {
    type: "build_fail",
    error,
  })
  host.writeState(next)
  host.setMaintenance(false)
  record(host, next, {
    op: "prepare",
    result: "failed",
    actor: "helper",
    sha: state.candidateSha,
    error,
  })
  note(host, "failed", error)
  return { ok: false as const, error }
}

export function runPrepare(host: Host, request: HelperRequest) {
  const layout = host.layout()
  let state = host.readState()
  const sha = request.sha ?? ""
  let tip = ""
  try {
    tip = host.fetchTip()
  } catch (error) {
    const message = redactError(error)
    record(host, state, {
      op: "prepare",
      result: "failed",
      actor: request.actor,
      sha: request.sha,
      error: message,
    })
    return { ok: false as const, error: message }
  }
  const pinned = validatePinnedSha({
    sha,
    branch: layout.branch,
    configuredBranch: layout.branch,
    tip,
  })
  if (!pinned.ok) {
    record(host, state, {
      op: "prepare",
      result: "refused",
      actor: request.actor,
      sha: request.sha,
      error: pinned.reason,
    })
    return { ok: false as const, error: pinned.reason }
  }
  if (request.actor === "agent") {
    const row = request.approvalId ? host.readApproval(request.approvalId) : null
    const gate = gateSelfUpdate({
      op: "prepare",
      actor: "agent",
      approval: approvalOf(row),
      expected: {
        op: "update",
        sha: pinned.sha,
        from: state.active,
        to: state.active === "blue" ? "green" : "blue",
        branch: layout.branch,
      },
      now: host.now(),
    })
    if (!gate.allow) {
      record(host, state, {
        op: "prepare",
        result: "refused",
        actor: "agent",
        sha: pinned.sha,
        error: gate.reason,
      })
      return { ok: false as const, error: gate.reason }
    }
  }
  try {
    state = transition(
      { ...state, branch: layout.branch },
      { type: "prepare", sha: pinned.sha }
    )
  } catch (error) {
    const message = redactError(error)
    record(host, state, {
      op: "prepare",
      result: "refused",
      actor: request.actor,
      sha: pinned.sha,
      error: message,
    })
    return { ok: false as const, error: message }
  }
  host.writeState(state)
  record(host, state, {
    op: "prepare",
    result: "started",
    actor: request.actor,
    sha: pinned.sha,
    error: null,
  })
  const colour = state.candidate!
  const dir = colour === "blue" ? layout.blueDir : layout.greenDir
  try {
    note(host, "backup", "Backing up the active database.")
    host.backup("prepare")
    note(host, "fetch", `Checking out ${pinned.sha.slice(0, 12)} on ${colour}.`)
    host.syncCheckout(dir, pinned.sha)
    note(host, "build", `Installing and building ${colour}.`)
    host.installAndBuild(dir)
    note(host, "snapshot", "Copying the active database.")
    host.snapshotDb(state.active, colour)
    note(host, "migrate", "Applying migrations on the copy.")
    const report = host.migrate(colour)
    const gap = migrationGap(report)
    if (!gap.ok) {
      return failBuild(host, host.readState(), gap.reason)
    }
    note(host, "start", `Starting ${colour}.`)
    host.startColour(colour)
    const health = host.health(colour)
    const smoke = host.smoke(colour)
    if (!health.ok || !smoke.ok) {
      host.stopColour(colour)
      return failBuild(
        host,
        host.readState(),
        !health.ok ? `Health check failed (${health.status}).` : smoke.detail
      )
    }
    const release = host.changelog(state.activeSha, pinned.sha)
    host.writeRelease({
      branch: layout.branch,
      tipSha: pinned.sha,
      titles: release.titles,
      migrations: release.migrations,
    })
    const ready = transition(host.readState(), { type: "build_ok" })
    host.writeState(ready)
    record(host, ready, {
      op: "prepare",
      result: "ok",
      actor: "helper",
      sha: pinned.sha,
      error: null,
    })
    note(host, "ready", `${colour} is ready on port ${colourPort(layout, colour)}.`)
    return { ok: true as const }
  } catch (error) {
    const current = host.readState()
    if (current.phase === "building") return failBuild(host, current, redactError(error))
    return { ok: false as const, error: redactError(error) }
  }
}

function requireApproval(
  host: Host,
  request: HelperRequest,
  state: DeployState,
  sha: string
) {
  const row = request.approvalId ? host.readApproval(request.approvalId) : null
  const gate = gateSelfUpdate({
    op: request.op === "rollback" ? "rollback" : "switch",
    actor: request.actor,
    approval: approvalOf(row),
    expected: argsFor(request, state, sha),
    now: host.now(),
  })
  return gate
}

export function runSwitch(host: Host, request: HelperRequest) {
  const state = host.readState()
  const sha = state.candidateSha ?? ""
  if (request.sha !== sha) {
    const reason = "The approval is not for the prepared commit."
    record(host, state, {
      op: "switch",
      result: "refused",
      actor: request.actor,
      sha: request.sha,
      error: reason,
    })
    return { ok: false as const, error: reason }
  }
  const gate = requireApproval(host, request, state, sha)
  if (!gate.allow) {
    record(host, state, {
      op: "switch",
      result: "refused",
      actor: request.actor,
      sha,
      error: gate.reason,
    })
    return { ok: false as const, error: gate.reason }
  }
  let switching: DeployState
  try {
    switching = transition(state, { type: "switch_begin" })
  } catch (error) {
    const message = redactError(error)
    record(host, state, {
      op: "switch",
      result: "refused",
      actor: request.actor,
      sha,
      error: message,
    })
    return { ok: false as const, error: message }
  }
  host.writeState(switching)
  host.setMaintenance(true)
  record(host, switching, {
    op: "switch",
    result: "started",
    actor: request.actor,
    sha,
    error: null,
  })
  const candidate = switching.candidate!
  try {
    note(host, "maintenance", "The active colour is read-only.")
    host.backup("switch")
    note(host, "snapshot", "Taking the final database snapshot.")
    host.snapshotDb(switching.active, candidate)
    const report = host.migrate(candidate)
    const gap = migrationGap(report)
    if (!gap.ok) {
      host.setMaintenance(false)
      const aborted = transition(host.readState(), {
        type: "switch_abort",
        error: gap.reason,
      })
      host.writeState(aborted)
      record(host, aborted, {
        op: "switch",
        result: "refused",
        actor: "helper",
        sha,
        error: gap.reason,
      })
      note(host, "refused", gap.reason)
      return { ok: false as const, error: gap.reason }
    }
    note(host, "caddy", `Pointing the proxy at ${candidate}.`)
    host.pointCaddy(candidate)
    host.reloadCaddy()
    const health = host.health(candidate)
    const smoke = host.smoke(candidate)
    if (!health.ok || !smoke.ok) {
      const error = !health.ok ? `Health check failed (${health.status}).` : smoke.detail
      note(
        host,
        "rollback",
        "The new colour failed its health check. Restoring the proxy."
      )
      host.restoreCaddy()
      host.reloadCaddy()
      host.setMaintenance(false)
      const rolled = transition(host.readState(), { type: "switch_fail", error })
      host.writeState(rolled)
      record(host, rolled, {
        op: "switch",
        result: "failed",
        actor: "helper",
        sha,
        error,
      })
      record(host, rolled, {
        op: "rollback",
        result: "ok",
        actor: "helper",
        sha: rolled.activeSha,
        error: null,
      })
      return { ok: false as const, error }
    }
    host.setMaintenance(false)
    const active = transition(host.readState(), { type: "switch_ok" })
    host.writeState(active)
    record(host, active, {
      op: "switch",
      result: "ok",
      actor: "helper",
      sha,
      error: null,
    })
    note(host, "active", `${candidate} is serving. The previous colour is still running.`)
    return { ok: true as const }
  } catch (error) {
    const message = redactError(error)
    try {
      host.restoreCaddy()
      host.reloadCaddy()
    } catch {
      // The audit line records the original failure. The proxy file is the backup.
    }
    host.setMaintenance(false)
    const current = host.readState()
    const rolled =
      current.phase === "switching"
        ? transition(current, { type: "switch_fail", error: message })
        : current
    host.writeState(rolled)
    record(host, rolled, {
      op: "switch",
      result: "failed",
      actor: "helper",
      sha,
      error: message,
    })
    return { ok: false as const, error: message }
  }
}

export function runRollback(host: Host, request: HelperRequest) {
  const state = host.readState()
  const sha = state.previousSha ?? ""
  if (!state.previous || request.sha !== sha) {
    const reason = "There is no previous colour to roll back to."
    record(host, state, {
      op: "rollback",
      result: "refused",
      actor: request.actor,
      sha: request.sha,
      error: reason,
    })
    return { ok: false as const, error: reason }
  }
  const gate = requireApproval(host, request, state, sha)
  if (!gate.allow) {
    record(host, state, {
      op: "rollback",
      result: "refused",
      actor: request.actor,
      sha,
      error: gate.reason,
    })
    return { ok: false as const, error: gate.reason }
  }
  let switching: DeployState
  try {
    switching = transition(state, { type: "rollback_begin" })
  } catch (error) {
    const message = redactError(error)
    record(host, state, {
      op: "rollback",
      result: "refused",
      actor: request.actor,
      sha,
      error: message,
    })
    return { ok: false as const, error: message }
  }
  host.writeState(switching)
  host.setMaintenance(true)
  record(host, switching, {
    op: "rollback",
    result: "started",
    actor: request.actor,
    sha,
    error: null,
  })
  const previous = switching.previous!
  try {
    note(host, "caddy", `Pointing the proxy back at ${previous}.`)
    host.pointCaddy(previous)
    host.reloadCaddy()
    const health = host.health(previous)
    if (!health.ok) {
      const error = `Health check failed (${health.status}).`
      host.restoreCaddy()
      host.reloadCaddy()
      host.setMaintenance(false)
      const stayed = transition(host.readState(), { type: "rollback_fail", error })
      host.writeState(stayed)
      record(host, stayed, {
        op: "rollback",
        result: "failed",
        actor: "helper",
        sha,
        error,
      })
      return { ok: false as const, error }
    }
    host.setMaintenance(false)
    const rolled = transition(host.readState(), { type: "rollback_ok" })
    host.writeState(rolled)
    record(host, rolled, {
      op: "rollback",
      result: "ok",
      actor: "helper",
      sha,
      error: null,
    })
    note(host, "rolled_back", `${previous} is serving again.`)
    return { ok: true as const }
  } catch (error) {
    const message = redactError(error)
    try {
      host.restoreCaddy()
      host.reloadCaddy()
    } catch {
      // recorded below
    }
    host.setMaintenance(false)
    const current = host.readState()
    const stayed =
      current.phase === "switching"
        ? transition(current, { type: "rollback_fail", error: message })
        : current
    host.writeState(stayed)
    record(host, stayed, {
      op: "rollback",
      result: "failed",
      actor: "helper",
      sha,
      error: message,
    })
    return { ok: false as const, error: message }
  }
}

export function runStatus(host: Host) {
  const state = host.readState()
  const layout = host.layout()
  try {
    const tip = host.fetchTip()
    const release = host.changelog(state.activeSha, tip)
    host.writeRelease({
      branch: layout.branch,
      tipSha: tip,
      titles: release.titles,
      migrations: release.migrations,
    })
    return { ok: true as const, tip }
  } catch (error) {
    return { ok: false as const, error: redactError(error) }
  }
}

export function emptyState() {
  return initialState()
}
