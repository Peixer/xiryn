import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { formatAudit } from "@/lib/self-update/audit"
import { commandAllowed, serviceArgv, serviceUserName } from "@/lib/self-update/allowlist"
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

function serviceAccount() {
  const name = serviceUserName()
  const text = fs.readFileSync("/etc/passwd", "utf8")
  for (const line of text.split("\n")) {
    const [user, , uidText, gidText, , home] = line.split(":")
    if (user !== name) continue
    const uid = Number(uidText)
    const gid = Number(gidText)
    if (!Number.isInteger(uid) || uid <= 0 || !home?.startsWith("/")) {
      throw new Error("The service user is not usable.")
    }
    return { name, uid, gid, home }
  }
  throw new Error("The service user does not exist.")
}

function ownTree(target: string, uid: number, gid: number) {
  if (!fs.existsSync(target)) return
  const visit = (file: string) => {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) {
      fs.lchownSync(file, uid, gid)
      return
    }
    fs.chownSync(file, uid, gid)
    if (!stat.isDirectory()) return
    for (const name of fs.readdirSync(file)) visit(path.join(file, name))
  }
  visit(target)
}

function ownService(target: string) {
  const account = serviceAccount()
  ownTree(target, account.uid, account.gid)
}

// Caches and the backup staging directory. The oneshot keeps ProtectHome
// read-only, so npm and next must not write under the service user's home.
function serviceDirs(layout: Layout) {
  const root = layout.deployDir
  return {
    root,
    npmCache: path.join(root, "npm-cache"),
    xdgCache: path.join(root, "cache"),
    xdgConfig: path.join(root, "config"),
    staging: path.join(root, "staging"),
  }
}

function ensureServiceDirs(layout: Layout) {
  const dirs = serviceDirs(layout)
  const account = serviceAccount()
  fs.mkdirSync(dirs.root, { recursive: true, mode: 0o700 })
  // Root-owned 0700 would hide every cache inside it from the service user.
  if (fs.statSync(dirs.root).uid === 0) fs.chownSync(dirs.root, account.uid, account.gid)
  for (const dir of [dirs.npmCache, dirs.xdgCache, dirs.xdgConfig, dirs.staging]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    ownTree(dir, account.uid, account.gid)
  }
  return dirs
}

function serviceEnv(layout: Layout): NodeJS.ProcessEnv {
  const account = serviceAccount()
  const dirs = ensureServiceDirs(layout)
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: account.home,
    USER: account.name,
    LOGNAME: account.name,
    GIT_TERMINAL_PROMPT: "0",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_cache: dirs.npmCache,
    XDG_CACHE_HOME: dirs.xdgCache,
    XDG_CONFIG_HOME: dirs.xdgConfig,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
  }
}

function runRoot(layout: Layout, argv: readonly string[]) {
  if (!commandAllowed(argv, layout, serviceUserName())) {
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

// Colour git, npm, and node. setpriv drops to the service user before the
// command, with a fixed argv the allow-list accepts and an environment that
// does not inherit this process.
function runAsService(layout: Layout, argv: readonly string[]) {
  const account = serviceAccount()
  const wrapped = serviceArgv(account.name, argv)
  if (!commandAllowed(wrapped, layout, account.name)) {
    throw new Error("Refusing a command outside the helper allow-list.")
  }
  return execFileSync(wrapped[0], wrapped.slice(1), {
    encoding: "utf8",
    timeout: 30 * 60_000,
    env: serviceEnv(layout),
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
      runRoot(layout, [
        "git",
        "--git-dir",
        mirror,
        "fetch",
        "--prune",
        "origin",
        `+refs/heads/${layout.branch}:refs/heads/${layout.branch}`,
      ])
      const tip = runRoot(layout, [
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
      const safe = `safe.directory=${layout.mirror}`
      // upload-pack is the process that opens the root-owned mirror. -c on the
      // parent is not enough: this git does not forward it to that child.
      const pack = `git -c ${safe} upload-pack`
      const ref = `+refs/heads/${layout.branch}:refs/remotes/pin/${layout.branch}`
      if (!fs.existsSync(path.join(dest, ".git"))) {
        fs.rmSync(dest, { recursive: true, force: true })
        fs.mkdirSync(dest, { recursive: true, mode: 0o755 })
        ownService(dest)
        runAsService(layout, [
          "git",
          "-c",
          safe,
          "clone",
          "--no-checkout",
          "--upload-pack",
          pack,
          layout.mirror,
          dest,
        ])
      } else {
        ownService(dest)
      }
      runAsService(layout, [
        "git",
        "-C",
        dest,
        "-c",
        safe,
        "fetch",
        "--upload-pack",
        pack,
        layout.mirror,
        ref,
      ])
      runAsService(layout, ["git", "-C", dest, "checkout", "--detach", sha])
      ownService(dest)
    },
    installAndBuild(dest) {
      ownService(dest)
      runAsService(layout, ["npm", "--prefix", dest, "ci", "--no-audit", "--no-fund"])
      runAsService(layout, ["npm", "--prefix", dest, "run", "build"])
      ownService(dest)
    },
    snapshotDb(from, to) {
      const script = path.join(
        colourDir(layout, this.readState().active),
        "scripts",
        "self-update-snapshot.mjs"
      )
      const fallback = "/usr/local/lib/xiryn/self-update-snapshot.mjs"
      const file = fs.existsSync(script) ? script : fallback
      const source = colourData(layout, from)
      const dest = colourData(layout, to)
      if (fs.existsSync(source)) ownService(source)
      fs.mkdirSync(dest, { recursive: true, mode: 0o700 })
      ownService(dest)
      runAsService(layout, ["node", file, "--from", source, "--to", dest])
      ownService(dest)
    },
    migrate(colour) {
      const script = "/usr/local/lib/xiryn/self-update-migrate.mjs"
      const local = path.join(
        colourDir(layout, colour),
        "scripts",
        "self-update-migrate.mjs"
      )
      const file = fs.existsSync(local) ? local : script
      const data = colourData(layout, colour)
      ownService(data)
      const out = runAsService(layout, [
        "node",
        file,
        "--data",
        data,
        "--migrations",
        `${colourDir(layout, colour)}/db/migrations`,
      ])
      ownService(data)
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
      runRoot(layout, ["systemctl", "start", colourUnit(colour)])
    },
    stopColour(colour) {
      runRoot(layout, ["systemctl", "stop", colourUnit(colour)])
    },
    pause(ms) {
      if (ms <= 0) return
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    },
    health(colour) {
      const port = colour === "blue" ? layout.bluePort : layout.greenPort
      try {
        const body = runRoot(layout, [
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
      const unit = runRoot(layout, ["systemctl", "is-active", colourUnit(colour)]).trim()
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
      runRoot(layout, ["caddy", "reload", "--config", layout.caddyfile])
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
      const dirs = ensureServiceDirs(layout)
      const stage = path.join(dirs.staging, `${stamp}-${label}`)
      const dest = path.join(layout.backupDir, `${stamp}-${label}`)
      fs.mkdirSync(stage, { recursive: true, mode: 0o700 })
      ownService(stage)
      const state = this.readState()
      const local = path.join(
        colourDir(layout, state.active),
        "scripts",
        "self-update-snapshot.mjs"
      )
      const file = fs.existsSync(local)
        ? local
        : "/usr/local/lib/xiryn/self-update-snapshot.mjs"
      const source = colourData(layout, state.active)
      if (fs.existsSync(source)) ownService(source)
      // The service user cannot write /var/backups/xiryn (root, mode 0700).
      // Snapshot into staging, then move the tree across as root.
      runAsService(layout, ["node", file, "--from", source, "--to", stage])
      fs.mkdirSync(layout.backupDir, { recursive: true, mode: 0o700 })
      fs.chownSync(layout.backupDir, 0, 0)
      mode(layout.backupDir, 0o700)
      moveTree(stage, dest)
      sealRoot(dest)
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
      fs.chownSync(note, 0, 0)
    },
    readApproval(id) {
      if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null
      return queryApproval(layout, this.readState(), id, false)
    },
    takeApproval(id) {
      if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null
      return queryApproval(layout, this.readState(), id, true)
    },
    writeRelease(release) {
      const file = path.join(dir, "release.json")
      fs.writeFileSync(file, `${JSON.stringify(release)}\n`, { mode: 0o644 })
    },
    changelog(from, to) {
      if (!from || !isSha(from) || !isSha(to) || from === to) {
        return { titles: [], migrations: [] }
      }
      const log = runRoot(layout, [
        "git",
        "--git-dir",
        layout.mirror,
        "log",
        "--format=%H%x09%s",
        `${from}..${to}`,
      ])
      const diff = runRoot(layout, [
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
  fs.chownSync(to, 0, 0)
  mode(to, 0o600)
}

function moveTree(from: string, to: string) {
  try {
    fs.renameSync(from, to)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EXDEV") throw error
    fs.cpSync(from, to, { recursive: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

function sealRoot(target: string) {
  const visit = (file: string) => {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) {
      fs.lchownSync(file, 0, 0)
      return
    }
    fs.chownSync(file, 0, 0)
    if (stat.isDirectory()) {
      fs.chmodSync(file, 0o700)
      for (const name of fs.readdirSync(file)) visit(path.join(file, name))
      return
    }
    fs.chmodSync(file, 0o600)
  }
  visit(target)
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

function queryApproval(layout: Layout, state: DeployState, id: string, consume: boolean) {
  const script = path.join(
    colourDir(layout, state.active),
    "scripts",
    "self-update-approval.mjs"
  )
  const file = fs.existsSync(script)
    ? script
    : "/usr/local/lib/xiryn/self-update-approval.mjs"
  try {
    const data = colourData(layout, state.active)
    if (fs.existsSync(data)) ownService(data)
    const argv = ["node", file, "--db", path.join(data, "xiryn.db"), "--id", id]
    if (consume) argv.push("--consume")
    const out = runAsService(layout, argv)
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
