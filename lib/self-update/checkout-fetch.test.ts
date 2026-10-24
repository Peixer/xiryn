import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { ensureServiceUser, privilegeGap } from "./host-fixture"
import { DEFAULT_LAYOUT, type Layout } from "./layout"
import { createSystemHost } from "./system-host"

const CHILD = process.env.XIRYN_CHECKOUT_CHILD === "1"
const USER = "xirynfetch"

function gitEnv(home: string) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    NODE_ENV: "production" as const,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  }
}

test(
  "a later checkout fetches the new commit, including a tree whose origin is not the mirror",
  { skip: CHILD, timeout: 120_000 },
  (t) => {
    const gap = privilegeGap()
    if ("skip" in gap) {
      if (process.env.GITHUB_ACTIONS === "true") {
        assert.fail(`${gap.skip}; CI must run this test`)
      }
      t.skip(gap.skip)
      return
    }
    const result = spawnSync(
      "sudo",
      [
        "-n",
        "env",
        `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`,
        "XIRYN_CHECKOUT_CHILD=1",
        `XIRYN_USERADD=${gap.useradd}`,
        `XIRYN_SERVICE_USER=${USER}`,
        process.execPath,
        "--import",
        "tsx",
        "--test",
        "lib/self-update/checkout-fetch.test.ts",
      ],
      { encoding: "utf8", cwd: process.cwd() }
    )
    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
      assert.fail(output || `checkout child exited ${result.status}`)
    }
  }
)

test(
  "syncCheckout fetches the mirror before checkout",
  { skip: !CHILD, timeout: 120_000 },
  () => {
    assert.equal(process.getuid?.(), 0)
    ensureServiceUser(USER, process.env.XIRYN_USERADD ?? "")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynfetch"))
    fs.chmodSync(root, 0o755)
    const src = path.join(root, "src")
    const mirror = path.join(root, "pin.git")
    const env = gitEnv("/root")
    const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", env })
    const head = (dir: string) =>
      git(["-c", `safe.directory=${dir}`, "-C", dir, "rev-parse", "HEAD"]).trim()
    const origin = (dir: string) =>
      git([
        "-c",
        `safe.directory=${dir}`,
        "-C",
        dir,
        "remote",
        "get-url",
        "origin",
      ]).trim()
    const layout: Layout = {
      ...DEFAULT_LAYOUT,
      mirror,
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
    try {
      git(["init", "-b", "main", src])
      fs.writeFileSync(path.join(src, "README"), "one\n")
      git(["-C", src, "add", "README"])
      git(["-C", src, "commit", "-m", "one"])
      const first = git(["-C", src, "rev-parse", "HEAD"]).trim()
      git(["clone", "--bare", src, mirror])
      execFileSync("chmod", ["-R", "a+rX", mirror])

      const host = createSystemHost(layout)
      host.syncCheckout(layout.greenDir, first)
      assert.equal(head(layout.greenDir), first)

      git(["clone", mirror, layout.blueDir])
      git([
        "-C",
        layout.blueDir,
        "remote",
        "set-url",
        "origin",
        "https://example.invalid/xiryn.git",
      ])
      assert.equal(origin(layout.blueDir), "https://example.invalid/xiryn.git")

      fs.appendFileSync(path.join(src, "README"), "two\n")
      git(["-C", src, "add", "README"])
      git(["-C", src, "commit", "-m", "two"])
      const second = git(["-C", src, "rev-parse", "HEAD"]).trim()
      git(["-C", src, "push", mirror, "main"])
      assert.notEqual(first, second)

      host.syncCheckout(layout.greenDir, second)
      assert.equal(head(layout.greenDir), second)

      host.syncCheckout(layout.blueDir, second)
      assert.equal(head(layout.blueDir), second)
      assert.equal(origin(layout.blueDir), "https://example.invalid/xiryn.git")
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
