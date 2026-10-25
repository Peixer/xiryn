import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { summarizeChangelog } from "@/lib/self-update/changelog"
import { parseDeployConf, DEFAULT_LAYOUT, type Layout } from "@/lib/self-update/layout"
import { redact } from "@/lib/self-update/redact"
import { isSha } from "@/lib/self-update/sha"
import {
  initialState,
  isUtcTimestamp,
  type DeployState,
  type Phase,
} from "@/lib/self-update/state"

export type ProgressLine = { ts: string; step: string; message: string }

export type GithubUpdateInfo = {
  available: boolean
  behind: number | null
  latestVersion: string | null
  checkedAt: string
}

export type GithubUpdatePayload =
  | (GithubUpdateInfo & { enabled: true })
  | { enabled: false }
  | null

export type SelfUpdateView = {
  configured: boolean
  phase: Phase
  active: DeployState["active"]
  activeSha: string | null
  candidate: DeployState["candidate"]
  candidateSha: string | null
  previous: DeployState["previous"]
  previousSha: string | null
  branch: string
  tipSha: string | null
  titles: string[]
  migrations: string[]
  includesMigrations: boolean
  updateAvailable: boolean
  error: string | null
  maintenance: boolean
  standbyUrl: string | null
  logs: ProgressLine[]
  githubUpdate?: GithubUpdatePayload
}

const PHASES = new Set([
  "idle",
  "building",
  "ready",
  "switching",
  "active",
  "rolled_back",
])

export function deployDir(layout?: Layout) {
  return process.env.XIRYN_DEPLOY_DIR || layout?.deployDir || DEFAULT_LAYOUT.deployDir
}

export function confPath() {
  return process.env.XIRYN_DEPLOY_CONF || "/etc/xiryn-deploy.conf"
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function asState(value: unknown): DeployState | null {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<DeployState>
  if (typeof record.phase !== "string" || !PHASES.has(record.phase)) return null
  if (record.active !== "blue" && record.active !== "green") return null
  return {
    ...initialState(),
    ...record,
    phase: record.phase,
    active: record.active,
    activeSha: isSha(record.activeSha ?? "") ? record.activeSha! : null,
    candidateSha: isSha(record.candidateSha ?? "") ? record.candidateSha! : null,
    previousSha: isSha(record.previousSha ?? "") ? record.previousSha! : null,
    candidate:
      record.candidate === "blue" || record.candidate === "green"
        ? record.candidate
        : null,
    previous:
      record.previous === "blue" || record.previous === "green" ? record.previous : null,
    error: typeof record.error === "string" ? redact(record.error).slice(0, 500) : null,
    branch: typeof record.branch === "string" ? record.branch : "main",
    switchedAt: isUtcTimestamp(record.switchedAt) ? record.switchedAt : null,
  }
}

function git(mirror: string, args: string[]) {
  // The pin mirror is root-owned. The app runs as the service user, and git
  // refuses that tree as dubious ownership unless this directory is named.
  return execFileSync("git", ["-c", `safe.directory=${mirror}`, ...args], {
    encoding: "utf8",
    timeout: 8000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim()
}

function readLogs(file: string): ProgressLine[] {
  try {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").slice(-80)
    return lines.flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<ProgressLine>
        if (typeof parsed.message !== "string" || typeof parsed.step !== "string")
          return []
        return [
          {
            ts: typeof parsed.ts === "string" ? parsed.ts : "",
            step: redact(parsed.step).slice(0, 40),
            message: redact(parsed.message).slice(0, 400),
          },
        ]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function readDeployState(): DeployState {
  let layout = DEFAULT_LAYOUT
  try {
    if (fs.existsSync(confPath()))
      layout = parseDeployConf(fs.readFileSync(confPath(), "utf8"))
  } catch {
    layout = DEFAULT_LAYOUT
  }
  return (
    asState(readJson(path.join(deployDir(layout), "state.json"))) ??
    initialState({ branch: layout.branch })
  )
}

export function loadSelfUpdateView(): SelfUpdateView {
  let layout = DEFAULT_LAYOUT
  let configured = false
  try {
    if (fs.existsSync(confPath())) {
      layout = parseDeployConf(fs.readFileSync(confPath(), "utf8"))
      configured = true
    }
  } catch {
    configured = false
  }
  const dir = deployDir(layout)
  const state =
    asState(readJson(path.join(dir, "state.json"))) ??
    initialState({ branch: layout.branch })
  if (fs.existsSync(path.join(dir, "state.json"))) configured = true

  let tipSha: string | null = null
  let titles: string[] = []
  let migrations: string[] = []
  const release = readJson(path.join(dir, "release.json")) as {
    tipSha?: string
    titles?: unknown
    migrations?: unknown
  } | null
  if (release && isSha(release.tipSha ?? "")) {
    tipSha = release.tipSha!
    const summary = summarizeChangelog({
      commits: Array.isArray(release.titles)
        ? release.titles
            .filter((item): item is string => typeof item === "string")
            .map((title) => ({
              sha: tipSha!,
              title,
            }))
        : [],
      migrationPaths: Array.isArray(release.migrations)
        ? release.migrations
            .filter((item): item is string => typeof item === "string")
            .map((name) => `db/migrations/${path.basename(name)}`)
        : [],
    })
    titles = summary.titles
    migrations = summary.migrations
  } else if (fs.existsSync(layout.mirror)) {
    try {
      const tip = git(layout.mirror, [
        "--git-dir",
        layout.mirror,
        "rev-parse",
        `refs/heads/${layout.branch}`,
      ])
      if (isSha(tip)) {
        tipSha = tip
        if (state.activeSha && state.activeSha !== tip) {
          const log = git(layout.mirror, [
            "--git-dir",
            layout.mirror,
            "log",
            "--format=%H%x09%s",
            `${state.activeSha}..${tip}`,
          ])
          const diff = git(layout.mirror, [
            "--git-dir",
            layout.mirror,
            "diff",
            "--name-only",
            state.activeSha,
            tip,
            "--",
            "db/migrations",
          ])
          const summary = summarizeChangelog({
            commits: log.split("\n").flatMap((line) => {
              const [sha, title] = line.split("\t")
              if (!sha || !title || !isSha(sha)) return []
              return [{ sha, title }]
            }),
            migrationPaths: diff.split("\n").filter(Boolean),
          })
          titles = summary.titles
          migrations = summary.migrations
        }
      }
    } catch {
      tipSha = null
    }
  }

  const includesMigrations = migrations.length > 0
  return {
    configured,
    phase: state.phase,
    active: state.active,
    activeSha: state.activeSha,
    candidate: state.candidate,
    candidateSha: state.candidateSha,
    previous: state.previous,
    previousSha: state.previousSha,
    branch: layout.branch || state.branch,
    tipSha,
    titles,
    migrations,
    includesMigrations,
    updateAvailable: Boolean(tipSha && state.activeSha && tipSha !== state.activeSha),
    error: state.error,
    maintenance: state.maintenance,
    standbyUrl: layout.standbyUrl,
    logs: readLogs(path.join(dir, "progress.jsonl")),
  }
}
