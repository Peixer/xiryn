import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

import { serviceArgv } from "./allowlist"
import { runPrepare, type Host } from "./helper"
import { DEFAULT_LAYOUT, type Layout } from "./layout"
import { createSystemHost } from "./system-host"

const CHILD = process.env.XIRYN_PREPARE_CHILD === "1"
const USER = "xirynprep"
const SHA = "c".repeat(40)

function privilegeGap() {
  const sudo = spawnSync("sudo", ["-n", "true"], { encoding: "utf8" })
  if (sudo.error || sudo.status !== 0) return "passwordless sudo is unavailable"
  const useradd = spawnSync("sudo", ["-n", "sh", "-c", "command -v useradd"], {
    encoding: "utf8",
  })
  if (useradd.status !== 0 || !useradd.stdout.trim()) return "useradd is unavailable"
  return null
}

function writeExe(file: string, body: string) {
  fs.writeFileSync(file, body)
  fs.chmodSync(file, 0o755)
}

function asUser(argv: readonly string[], home: string) {
  const wrapped = serviceArgv(USER, argv)
  return spawnSync(wrapped[0], wrapped.slice(1), {
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: home,
      USER,
      LOGNAME: USER,
      NODE_ENV: "production",
    },
  })
}

test(
  "prepare succeeds when backups are root-only and the service home is read-only",
  { skip: CHILD, timeout: 180_000 },
  (t) => {
    const reason = privilegeGap()
    if (reason) {
      if (process.env.GITHUB_ACTIONS === "true") {
        assert.fail(`${reason}; CI must run this test`)
      }
      t.skip(reason)
      return
    }
    const result = spawnSync(
      "sudo",
      [
        "-n",
        "env",
        `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`,
        "XIRYN_PREPARE_CHILD=1",
        `XIRYN_SERVICE_USER=${USER}`,
        process.execPath,
        "--import",
        "tsx",
        "--test",
        "lib/self-update/prepare-production.test.ts",
      ],
      { encoding: "utf8", cwd: process.cwd() }
    )
    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
      assert.fail(output || `prepare child exited ${result.status}`)
    }
  }
)

test(
  "backup staging and npm caches let prepare finish under production permissions",
  { skip: !CHILD, timeout: 180_000 },
  () => {
    if (spawnSync("id", [USER]).status !== 0) {
      const added = spawnSync("useradd", [
        "--create-home",
        "--shell",
        "/usr/sbin/nologin",
        "--user-group",
        USER,
      ])
      if (added.status !== 0 && spawnSync("id", [USER]).status !== 0) {
        throw new Error(added.stderr?.toString() || "useradd failed")
      }
    }
    const uid = Number(spawnSync("id", ["-u", USER], { encoding: "utf8" }).stdout.trim())
    assert.notEqual(uid, 0)
    const home = spawnSync("getent", ["passwd", USER], { encoding: "utf8" }).stdout.split(
      ":"
    )[5]
    assert.ok(home?.startsWith("/"))
    const homeMode = fs.statSync(home).mode & 0o777

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynprep"))
    fs.chmodSync(root, 0o755)
    const repo = process.cwd()
    const fakeBin = path.join(root, "bin")
    fs.mkdirSync(fakeBin)
    fs.chmodSync(fakeBin, 0o755)
    writeExe(
      path.join(fakeBin, "git"),
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "--git-dir" ]; then
  shift 2
  cmd=$1
  shift || true
  case "$cmd" in
    fetch) exit 0 ;;
    rev-parse) printf '%s\\n' '${SHA}'; exit 0 ;;
    log|diff) exit 0 ;;
    *) echo "unexpected git $cmd" >&2; exit 1 ;;
  esac
fi
if [ "\${1:-}" = "-C" ]; then
  dest=$2
  mkdir -p "$dest/scripts" "$dest/db"
  printf '%s\\n' checked > "$dest/checked-out"
  ln -sfn '${repo}/scripts/self-update-migrate.mjs' "$dest/scripts/self-update-migrate.mjs"
  ln -sfn '${repo}/scripts/self-update-snapshot.mjs' "$dest/scripts/self-update-snapshot.mjs"
  ln -sfn '${repo}/db/migrations' "$dest/db/migrations"
  exit 0
fi
dest=
for arg in "$@"; do dest=$arg; done
mkdir -p "$dest/.git"
printf '%s\\n' '{"name":"xiryn","private":true}' > "$dest/package.json"
exit 0
`
    )
    writeExe(
      path.join(fakeBin, "npm"),
      `#!/bin/sh
set -eu
cache="\${npm_config_cache:-$HOME/.npm}"
if ! mkdir -p "$cache/probe"; then exit 243; fi
printf '%s\\n' wrote > "$cache/probe/wrote"
if [ "\${NEXT_TELEMETRY_DISABLED:-}" != "1" ]; then
  echo "telemetry enabled" >&2
  exit 243
fi
if [ -z "\${XDG_CACHE_HOME:-}" ] || [ -z "\${XDG_CONFIG_HOME:-}" ]; then
  echo "xdg cache is unset" >&2
  exit 243
fi
case "$cache" in
  "$HOME"|"$HOME"/*) echo "npm cache is in HOME" >&2; exit 243 ;;
esac
case "$XDG_CACHE_HOME" in
  "$HOME"|"$HOME"/*) echo "xdg cache is in HOME" >&2; exit 243 ;;
esac
case "$XDG_CONFIG_HOME" in
  "$HOME"|"$HOME"/*) echo "xdg config is in HOME" >&2; exit 243 ;;
esac
mkdir -p "$XDG_CACHE_HOME/probe" "$XDG_CONFIG_HOME/probe"
printf '%s\\n' wrote > "$XDG_CACHE_HOME/probe/wrote"
prefix=
prev=
for arg in "$@"; do
  if [ "$prev" = "--prefix" ]; then prefix=$arg; fi
  prev=$arg
done
mkdir -p "$prefix/node_modules" "$prefix/.next"
printf '%s\\n' owned > "$prefix/node_modules/owned"
printf '%s\\n' build > "$prefix/.next/BUILD_ID"
`
    )
    writeExe(
      path.join(fakeBin, "systemctl"),
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "is-active" ]; then printf '%s\\n' active; fi
exit 0
`
    )
    writeExe(
      path.join(fakeBin, "curl"),
      `#!/bin/sh
printf '%s\\n' '{"status":"ok"}'
`
    )
    process.env.PATH = `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`

    const layout: Layout = {
      ...DEFAULT_LAYOUT,
      mirror: path.join(root, "mirror.git"),
      blueDir: path.join(root, "blue"),
      greenDir: path.join(root, "green"),
      blueData: path.join(root, "data-blue"),
      greenData: path.join(root, "data-green"),
      backupDir: path.join(root, "backups"),
      deployDir: path.join(root, "deploy"),
      caddyfile: path.join(root, "Caddyfile"),
      caddySnippet: path.join(root, "upstreams.caddy"),
      sharedEnv: path.join(root, "shared.env"),
      vaultDir: path.join(root, "vault"),
      maintenanceFile: path.join(root, "maintenance"),
    }
    fs.mkdirSync(layout.mirror)
    fs.mkdirSync(layout.backupDir)
    fs.chownSync(layout.backupDir, 0, 0)
    fs.chmodSync(layout.backupDir, 0o700)
    fs.mkdirSync(path.join(layout.blueDir, "scripts"), { recursive: true })
    fs.symlinkSync(
      path.join(repo, "scripts/self-update-snapshot.mjs"),
      path.join(layout.blueDir, "scripts", "self-update-snapshot.mjs")
    )
    fs.mkdirSync(path.join(layout.blueData, "skills", "demo"), { recursive: true })
    fs.writeFileSync(path.join(layout.blueData, "skills", "demo", "SKILL.md"), "skill\n")
    const db = new Database(path.join(layout.blueData, "xiryn.db"))
    db.exec("create table t (id integer)")
    db.close()
    fs.writeFileSync(layout.sharedEnv, "XIRYN_PORT=6796\n", { mode: 0o640 })
    fs.mkdirSync(layout.vaultDir)
    fs.writeFileSync(path.join(layout.vaultDir, "vault-live.key"), "secret\n", {
      mode: 0o600,
    })

    fs.chmodSync(home, 0o555)
    try {
      const homeWrite = asUser(["/usr/bin/touch", path.join(home, ".npm-probe")], home)
      assert.notEqual(homeWrite.status, 0)
      const backupWrite = asUser(
        ["/usr/bin/touch", path.join(layout.backupDir, "nope")],
        home
      )
      assert.notEqual(backupWrite.status, 0)

      const host: Host = createSystemHost(layout)
      const result = runPrepare(host, {
        op: "prepare",
        sha: SHA,
        approvalId: null,
        actor: "owner",
        requestedAt: "2026-10-24T10:00:00.000Z",
      })
      assert.equal(result.ok, true, result.ok ? "" : result.error)
      assert.equal(host.readState().phase, "ready")
      host.backup("switch")

      assert.equal(fs.statSync(layout.backupDir).uid, 0)
      assert.equal(fs.statSync(layout.backupDir).mode & 0o777, 0o700)
      for (const suffix of ["-prepare", "-switch"]) {
        const names = fs
          .readdirSync(layout.backupDir)
          .filter((name) => name.endsWith(suffix))
        assert.equal(names.length, 1, suffix)
        const dir = path.join(layout.backupDir, names[0])
        assert.equal(fs.statSync(dir).uid, 0, dir)
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700, dir)
        for (const file of [
          "xiryn.db",
          "skills/demo/SKILL.md",
          "shared.env",
          "vault-live.key",
          "label.txt",
        ]) {
          const target = path.join(dir, file)
          assert.equal(fs.statSync(target).uid, 0, target)
          assert.equal(fs.statSync(target).mode & 0o777, 0o600, target)
        }
        assert.equal(
          fs.readFileSync(path.join(dir, "skills/demo/SKILL.md"), "utf8"),
          "skill\n"
        )
        const readable = asUser(["/usr/bin/test", "-r", path.join(dir, "xiryn.db")], home)
        assert.notEqual(readable.status, 0)
      }
      assert.deepEqual(fs.readdirSync(path.join(layout.deployDir, "staging")), [])
      const cache = path.join(layout.deployDir, "npm-cache", "probe", "wrote")
      assert.equal(fs.statSync(cache).uid, uid)
      assert.equal(
        fs.statSync(path.join(layout.deployDir, "cache", "probe", "wrote")).uid,
        uid
      )
      assert.equal(fs.existsSync(path.join(home, ".npm")), false)
    } finally {
      fs.chmodSync(home, homeMode)
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
