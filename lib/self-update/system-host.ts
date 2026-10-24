import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { formatAudit } from "@/lib/self-update/audit"
import { commandAllowed } from "@/lib/self-update/allowlist"
import { summarizeChangelog } from "@/lib/self-update/changelog"
import {
  colourData,
  colourDir,
  colourUnit,
  DEFAULT_LAYOUT,
  parseDeployConf,
  type Layout,
} from "@/lib/self-update/layout"
import { redact, redactError } from "@/lib/self-update/redact"
import { isSha } from "@/lib/self-update/sha"
import { initialState, type DeployState } from "@/lib/self-update/state"
import type { Host } from "@/lib/self-update/helper"

function run(layout: Layout, argv: readonly string[]) {
  if (!commandAllowed(argv, layout)) {
    throw new Error("Refusing a command outside the helper allow-list.")
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: "/root",
    GIT_TERMINAL_PROMPT: "0",
    npm_config_fund: "false",
    npm_config_audit: "false",
    NODE_ENV: "production",
  }
  return execFileSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: 30 * 60_000,
    env,
  })
}

function mode(file: string, bits: number) {
  fs.chmodSync(file, bits)
}

export function loadLayout(): Layout {
  const file = process.env.XIRYN_DEPLOY_CONF || "/etc/xiryn-deploy.conf"
  if (!fs.existsSync(file)) return DEFAULT_LAYOUT
  return parseDeployConf(fs.readFileSync(file, "utf8"))
}

export function createSystemHost(layout = loadLayout()): Host {
  const dir = process.env.XIRYN_DEPLOY_DIR || layout.deployDir
  const stateFile = path.join(dir, "state.json")
  const progressFile = path.join(dir, "progress.jsonl")
  const auditDir = path.join(dir, "audit")
  let caddyBackup: string | null = null

  const writeState = (state: DeployState) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
    const tmp = path.join(dir, ".state.json.tmp")
    fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o644 })
    fs.renameSync(tmp, stateFile)
    mode(stateFile, 0o644)
  }

  return {
    now: () => Date.now(),
    layout: () => layout,
    readState() {
      try {
        return { ...initialState(), ...JSON.parse(fs.readFileSync(stateFile, "utf8")) }
      } catch {
        return initialState({ branch: layout.branch })
      }
    },
    writeState,
    progress(step, message) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
      fs.appendFileSync(
        progressFile,
        `${JSON.stringify({ ts: new Date().toISOString(), step: redact(step), message: redact(message) })}\n`,
        { mode: 0o640 }
      )
    },
    audit(entry) {
      fs.mkdirSync(auditDir, { recursive: true, mode: 0o730 })
      const line = formatAudit({ ...entry, ts: entry.ts ?? new Date().toISOString() })
      const name = `${Date.now()}-${entry.op}-${entry.result}.json`
      const file = path.join(auditDir, name)
      fs.writeFileSync(file, `${line}\n`, { mode: 0o600 })
      mode(file, 0o600)
    },
    fetchTip() {
      const mirror = layout.mirror
      if (!fs.existsSync(mirror)) {
        throw new Error("The pin mirror is missing. Run deploy/migrate-blue-green.sh.")
      }
      run(layout, [
        "git",
        "--git-dir",
        mirror,
        "fetch",
        "--prune",
        "origin",
        `+refs/heads/${layout.branch}:refs/heads/${layout.branch}`,
      ])
      const tip = run(layout, [
        "git",
        "--git-dir",
        mirror,
        "rev-parse",
        `refs/heads/${layout.branch}`,
      ]).trim()
      if (!isSha(tip)) throw new Error("The branch tip is not a commit.")
      return tip
    },
    syncCheckout(dest, sha) {
      if (!fs.existsSync(path.join(dest, ".git"))) {
        fs.rmSync(dest, { recursive: true, force: true })
        run(layout, ["git", "clone", "--no-checkout", layout.mirror, dest])
      }
      run(layout, ["git", "-C", dest, "checkout", "--detach", sha])
    },
    installAndBuild(dest) {
      run(layout, ["npm", "--prefix", dest, "ci", "--no-audit", "--no-fund"])
      run(layout, ["npm", "--prefix", dest, "run", "build"])
    },
    snapshotDb(from, to) {
      const script = path.join(
        colourDir(layout, this.readState().active),
        "scripts",
        "self-update-snapshot.mjs"
      )
      const fallback = "/usr/local/lib/xiryn/self-update-snapshot.mjs"
      const file = fs.existsSync(script) ? script : fallback
      fs.mkdirSync(colourData(layout, to), { recursive: true, mode: 0o700 })
      run(layout, [
        "node",
        file,
        "--from",
        colourData(layout, from),
        "--to",
        colourData(layout, to),
      ])
    },
    migrate(colour) {
      const script = "/usr/local/lib/xiryn/self-update-migrate.mjs"
      const local = path.join(
        colourDir(layout, colour),
        "scripts",
        "self-update-migrate.mjs"
      )
      const file = fs.existsSync(local) ? local : script
      const out = run(layout, [
        "node",
        file,
        "--data",
        colourData(layout, colour),
        "--migrations",
        `${colourDir(layout, colour)}/db/migrations`,
      ])
      const parsed = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
        journalCount?: number
        appliedCount?: number
      }
      return {
        journalCount: parsed.journalCount ?? -1,
        appliedCount: parsed.appliedCount ?? -1,
      }
    },
    startColour(colour) {
      run(layout, ["systemctl", "start", colourUnit(colour)])
    },
    stopColour(colour) {
      run(layout, ["systemctl", "stop", colourUnit(colour)])
    },
    health(colour) {
      const port = colour === "blue" ? layout.bluePort : layout.greenPort
      try {
        const body = run(layout, [
          "curl",
          "-fsS",
          "--max-time",
          "8",
          "-H",
          "Host: 127.0.0.1",
          `http://127.0.0.1:${port}/api/health`,
        ])
        const parsed = JSON.parse(body) as { status?: string }
        const status =
          parsed.status === "ok" || parsed.status === "degraded" ? parsed.status : "down"
        return { ok: status !== "down", status }
      } catch (error) {
        return { ok: false, status: redactError(error) }
      }
    },
    smoke(colour) {
      const unit = run(layout, ["systemctl", "is-active", colourUnit(colour)]).trim()
      if (unit !== "active")
        return { ok: false, detail: `${colourUnit(colour)} is ${unit}.` }
      const health = this.health(colour)
      if (!health.ok)
        return { ok: false, detail: `Health check failed (${health.status}).` }
      return { ok: true, detail: "ok" }
    },
    setMaintenance(on) {
      if (on) {
        fs.mkdirSync(path.dirname(layout.maintenanceFile), {
          recursive: true,
          mode: 0o755,
        })
        fs.writeFileSync(layout.maintenanceFile, "read-only\n", { mode: 0o644 })
      } else if (fs.existsSync(layout.maintenanceFile)) {
        fs.rmSync(layout.maintenanceFile)
      }
    },
    pointCaddy(active) {
      const app = active === "blue" ? layout.bluePort : layout.greenPort
      const desktop = active === "blue" ? layout.blueDesktopPort : layout.greenDesktopPort
      const standbyApp = active === "blue" ? layout.greenPort : layout.bluePort
      const standbyDesktop =
        active === "blue" ? layout.greenDesktopPort : layout.blueDesktopPort
      const body = caddySnippet({ app, desktop, standbyApp, standbyDesktop })
      if (fs.existsSync(layout.caddySnippet)) {
        caddyBackup = `${layout.caddySnippet}.bak`
        fs.copyFileSync(layout.caddySnippet, caddyBackup)
        mode(caddyBackup, 0o644)
      }
      fs.writeFileSync(layout.caddySnippet, body, { mode: 0o644 })
    },
    reloadCaddy() {
      run(layout, ["caddy", "reload", "--config", layout.caddyfile])
    },
    restoreCaddy() {
      if (caddyBackup && fs.existsSync(caddyBackup)) {
        fs.copyFileSync(caddyBackup, layout.caddySnippet)
      }
    },
    backup(label) {
      if (label !== "prepare" && label !== "switch") {
        throw new Error("Refusing a backup label outside the allow-list.")
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const dest = path.join(layout.backupDir, `${stamp}-${label}`)
      fs.mkdirSync(dest, { recursive: true, mode: 0o700 })
      mode(dest, 0o700)
      const state = this.readState()
      const local = path.join(
        colourDir(layout, state.active),
        "scripts",
        "self-update-snapshot.mjs"
      )
      const file = fs.existsSync(local)
        ? local
        : "/usr/local/lib/xiryn/self-update-snapshot.mjs"
      run(layout, [
        "node",
        file,
        "--from",
        colourData(layout, state.active),
        "--to",
        dest,
      ])
      if (fs.existsSync(layout.sharedEnv))
        copyPrivate(layout.sharedEnv, path.join(dest, "shared.env"))
      if (fs.existsSync(layout.vaultDir)) {
        for (const name of fs.readdirSync(layout.vaultDir)) {
          if (!name.startsWith("vault-") || !name.endsWith(".key")) continue
          copyPrivate(path.join(layout.vaultDir, name), path.join(dest, name))
        }
      }
      const note = path.join(dest, "label.txt")
      fs.writeFileSync(note, `${label}\n`, { mode: 0o600 })
      mode(note, 0o600)
    },
    readApproval(id) {
      if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null
      return readApproval(layout, this.readState(), id)
    },
    writeRelease(release) {
      const file = path.join(dir, "release.json")
      fs.writeFileSync(file, `${JSON.stringify(release)}\n`, { mode: 0o644 })
    },
    changelog(from, to) {
      if (!from || !isSha(from) || !isSha(to) || from === to) {
        return { titles: [], migrations: [] }
      }
      const log = run(layout, [
        "git",
        "--git-dir",
        layout.mirror,
        "log",
        "--format=%H%x09%s",
        `${from}..${to}`,
      ])
      const diff = run(layout, [
        "git",
        "--git-dir",
        layout.mirror,
        "diff",
        "--name-only",
        from,
        to,
        "--",
        "db/migrations",
      ])
      return summarizeChangelog({
        commits: log.split("\n").flatMap((line) => {
          const [sha, title] = line.split("\t")
          if (!sha || !title || !isSha(sha)) return []
          return [{ sha, title }]
        }),
        migrationPaths: diff.split("\n").filter(Boolean),
      })
    },
  }
}

function copyPrivate(from: string, to: string) {
  fs.copyFileSync(from, to)
  mode(to, 0o600)
}

function caddySnippet(ports: {
  app: number
  desktop: number
  standbyApp: number
  standbyDesktop: number
}) {
  return `# Generated by xiryn-helper. No secrets.
(xiryn_active) {
	reverse_proxy 127.0.0.1:${ports.app} {
		flush_interval -1
		header_up Host {host}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}
(xiryn_desktop) {
	reverse_proxy 127.0.0.1:${ports.desktop}
}
(xiryn_standby) {
	reverse_proxy 127.0.0.1:${ports.standbyApp} {
		flush_interval -1
		header_up Host {host}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}
(xiryn_standby_desktop) {
	reverse_proxy 127.0.0.1:${ports.standbyDesktop}
}
`
}

function readApproval(layout: Layout, state: DeployState, id: string) {
  const script = path.join(
    colourDir(layout, state.active),
    "scripts",
    "self-update-approval.mjs"
  )
  const file = fs.existsSync(script)
    ? script
    : "/usr/local/lib/xiryn/self-update-approval.mjs"
  try {
    const out = run(layout, [
      "node",
      file,
      "--db",
      path.join(colourData(layout, state.active), "xiryn.db"),
      "--id",
      id,
    ])
    const parsed = JSON.parse(out) as {
      tool?: string
      args?: string
      argsHash?: string
      status?: string
      expiresAt?: number | null
    }
    if (!parsed.tool || !parsed.args || !parsed.argsHash || !parsed.status) return null
    return {
      tool: parsed.tool,
      args: parsed.args,
      argsHash: parsed.argsHash,
      status: parsed.status,
      expiresAt: parsed.expiresAt ?? null,
    }
  } catch {
    return null
  }
}
