import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const COLOUR_KEYS = [
  "XIRYN_DATA_DIR",
  "XIRYN_PORT",
  "XIRYN_DESKTOP_PROXY_PORT",
  "XIRYN_VAULT_KEY_DIR",
] as const

function unquote(value: string) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function assign(env: Record<string, string>, text: string) {
  const eq = text.indexOf("=")
  if (eq <= 0) return
  const key = text.slice(0, eq).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return
  env[key] = unquote(text.slice(eq + 1))
}

// systemd.exec: EnvironmentFile overrides Environment=, and a later
// EnvironmentFile overrides an earlier one. Order in the unit is the order
// applied.
function effectiveEnvironment(unit: string, files: Record<string, string>) {
  const env: Record<string, string> = {}
  for (const raw of unit.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("Environment=")) {
      assign(env, line.slice("Environment=".length))
      continue
    }
    if (!line.startsWith("EnvironmentFile=")) continue
    let file = line.slice("EnvironmentFile=".length).trim()
    const optional = file.startsWith("-")
    if (optional) file = file.slice(1)
    const body = files[file]
    if (body == null) {
      if (!optional) throw new Error(`missing EnvironmentFile ${file}`)
      continue
    }
    for (const row of body.split("\n")) {
      const entry = row.trim()
      if (!entry || entry.startsWith("#") || entry.startsWith(";")) continue
      assign(env, entry)
    }
  }
  return env
}

test("each colour keeps its own data dir when shared.env names /opt/xiryn/data", () => {
  const shared = [
    "XIRYN_DATA_DIR=/opt/xiryn/data",
    "XIRYN_PORT=1",
    "XIRYN_DESKTOP_PROXY_PORT=2",
    "XIRYN_VAULT_KEY_DIR=/opt/xiryn/.xiryn",
    "XIRYN_DEPLOY_DIR=/tmp/nope",
    "BUILDX_CONFIG=/home/xiryn/.docker",
    "OPENAI_API_KEY=present",
    "",
  ].join("\n")

  for (const colour of ["blue", "green"] as const) {
    const unit = fs.readFileSync(path.join("deploy", `xiryn-${colour}.service`), "utf8")
    assert.equal(unit.includes("These win over"), false)
    for (const key of COLOUR_KEYS) {
      assert.equal(unit.includes(`Environment=${key}`), false, `${colour} ${key}`)
    }
    const sharedAt = unit.indexOf("EnvironmentFile=-/etc/xiryn/shared.env")
    const colourAt = unit.indexOf(`EnvironmentFile=/etc/xiryn/${colour}.env`)
    assert.ok(sharedAt >= 0 && colourAt > sharedAt, colour)
    const colourFile = fs.readFileSync(path.join("deploy", `xiryn-${colour}.env`), "utf8")
    const env = effectiveEnvironment(unit, {
      "/etc/xiryn/shared.env": shared,
      [`/etc/xiryn/${colour}.env`]: colourFile,
    })
    const data =
      colour === "blue" ? "/var/lib/xiryn/colours/blue" : "/var/lib/xiryn/colours/green"
    assert.equal(env.XIRYN_DATA_DIR, data)
    assert.equal(env.XIRYN_PORT, colour === "blue" ? "6796" : "6896")
    assert.equal(env.XIRYN_DESKTOP_PROXY_PORT, colour === "blue" ? "6797" : "6897")
    assert.equal(env.XIRYN_VAULT_KEY_DIR, "/etc/xiryn/vault")
    assert.equal(env.XIRYN_DEPLOY_DIR, "/var/lib/xiryn/deploy")
    assert.equal(env.XIRYN_COLOUR, colour)
    assert.equal(env.OPENAI_API_KEY, "present")
    assert.equal(env.NODE_ENV, "production")
    assert.notEqual(env.XIRYN_DATA_DIR, "/opt/xiryn/data")
    assert.equal(env.BUILDX_CONFIG, "/var/lib/xiryn/docker/buildx")
  }
})

test("the installer strips per-colour keys from shared.env without printing them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xirynstrip"))
  const file = path.join(dir, "shared.env")
  const secret = "sk-strip-test-value"
  fs.writeFileSync(
    file,
    [
      "# keep",
      `OPENAI_API_KEY=${secret}`,
      "XIRYN_DATA_DIR=/opt/xiryn/data",
      "export XIRYN_PORT=6796",
      "XIRYN_DESKTOP_PROXY_PORT=6797",
      "  XIRYN_VAULT_KEY_DIR=/opt/xiryn/.xiryn",
      "XIRYN_DATA_DIR_EXTRA=stay",
      "XIRYN_VAULT_ACCOUNT=0123456789abcdef",
      "OTHER=1",
      "",
    ].join("\n"),
    { mode: 0o640 }
  )
  const result = spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: {
      ...process.env,
      XIRYN_STRIP_ONLY: "1",
      XIRYN_SHARED_ENV: file,
      NODE_ENV: "production",
    },
  })
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`
    assert.equal(combined.includes(secret), false)
    assert.equal(combined.includes("/opt/xiryn/data"), false)
    const next = fs.readFileSync(file, "utf8")
    assert.equal(next.includes("XIRYN_DATA_DIR="), false)
    assert.equal(next.includes("XIRYN_PORT"), false)
    assert.equal(next.includes("XIRYN_DESKTOP_PROXY_PORT"), false)
    assert.equal(next.includes("XIRYN_VAULT_KEY_DIR"), false)
    assert.match(next, /^# keep$/m)
    assert.match(next, new RegExp(`^OPENAI_API_KEY=${secret}$`, "m"))
    assert.match(next, /^XIRYN_DATA_DIR_EXTRA=stay$/m)
    assert.match(next, /^XIRYN_VAULT_ACCOUNT=0123456789abcdef$/m)
    assert.match(next, /^OTHER=1$/m)
    assert.equal(fs.statSync(file).mode & 0o777, 0o640)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
