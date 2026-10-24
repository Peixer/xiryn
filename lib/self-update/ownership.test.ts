import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import Database from "better-sqlite3"

import { serviceArgv } from "./allowlist"
import {
  copyHelperTree,
  ensureServiceUser,
  installHelperRuntime,
  privilegeGap,
} from "./host-fixture"
import { DEFAULT_LAYOUT, type Layout } from "./layout"
import { createSystemHost } from "./system-host"

const CHILD = process.env.XIRYN_OWNERSHIP_CHILD === "1"
const USER = "xirynsu"
const SHA = "b".repeat(40)

test(
  "the service user owns the colour tree and database after build, snapshot, and migrate",
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
        "XIRYN_OWNERSHIP_CHILD=1",
        `XIRYN_USERADD=${gap.useradd}`,
        `XIRYN_SERVICE_USER=${USER}`,
        process.execPath,
        "--import",
        "tsx",
        "--test",
        "lib/self-update/ownership.test.ts",
      ],
      { encoding: "utf8", cwd: process.cwd() }
    )
    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
      assert.fail(output || `ownership child exited ${result.status}`)
    }
  }
)

test(
  "build, snapshot, and migrate leave the colour tree owned by the service user",
  { skip: !CHILD, timeout: 120_000 },
  () => {
    ensureServiceUser(USER, process.env.XIRYN_USERADD ?? "")
    const uid = Number(execFileSync("id", ["-u", USER], { encoding: "utf8" }).trim())
    assert.notEqual(uid, 0)
    const home = execFileSync("getent", ["passwd", USER], { encoding: "utf8" }).split(
      ":"
    )[5]
    assert.ok(home?.startsWith("/"))

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynown"))
    fs.chmodSync(root, 0o755)
    const runtime = installHelperRuntime(root)
    const fakeBin = path.join(root, "bin")
    fs.mkdirSync(fakeBin)
    fs.chmodSync(fakeBin, 0o755)
    const gitFake = path.join(fakeBin, "git")
    const npmFake = path.join(fakeBin, "npm")
    fs.writeFileSync(
      gitFake,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "-C" ]; then
  mkdir -p "$2"
  printf '%s\\n' checked > "$2/checked-out"
  exit 0
fi
dest=
for arg in "$@"; do
  dest=$arg
done
mkdir -p "$dest/.git"
printf '%s\\n' '{"name":"xiryn","private":true}' > "$dest/package.json"
`
    )
    fs.chmodSync(gitFake, 0o755)
    fs.writeFileSync(
      npmFake,
      `#!/bin/sh
set -eu
prefix=
prev=
for arg in "$@"; do
  if [ "$prev" = "--prefix" ]; then
    prefix=$arg
  fi
  prev=$arg
done
mkdir -p "$prefix/node_modules" "$prefix/.next"
printf '%s\\n' owned > "$prefix/node_modules/owned"
printf '%s\\n' build > "$prefix/.next/BUILD_ID"
`
    )
    fs.chmodSync(npmFake, 0o755)
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
    fs.mkdirSync(layout.mirror, { recursive: true })
    copyHelperTree(layout.blueDir, runtime)
    assert.equal(
      fs
        .lstatSync(path.join(layout.blueDir, "scripts", "self-update-snapshot.mjs"))
        .isFile(),
      true
    )
    fs.mkdirSync(path.join(layout.blueData, "skills", "demo"), { recursive: true })
    fs.mkdirSync(path.join(layout.blueData, "backups"), { recursive: true })
    fs.writeFileSync(path.join(layout.blueData, "skills", "demo", "SKILL.md"), "skill\n")
    fs.writeFileSync(path.join(layout.blueData, "backups", "old.db"), "old")
    fs.writeFileSync(path.join(layout.blueData, "vault-live.key"), "secret")
    fs.writeFileSync(path.join(layout.blueData, ".env"), "TOKEN=1\n")
    const db = new Database(path.join(layout.blueData, "xiryn.db"))
    db.exec("create table t (id integer)")
    db.close()

    try {
      const host = createSystemHost(layout)
      host.syncCheckout(layout.greenDir, SHA)
      host.installAndBuild(layout.greenDir)
      host.snapshotDb("blue", "green")
      copyHelperTree(layout.greenDir, runtime)
      assert.equal(
        fs
          .lstatSync(path.join(layout.greenDir, "scripts", "self-update-migrate.mjs"))
          .isFile(),
        true
      )
      host.migrate("green")

      const owned = [
        path.join(layout.greenDir, "package.json"),
        path.join(layout.greenDir, "checked-out"),
        path.join(layout.greenDir, "node_modules", "owned"),
        path.join(layout.greenDir, ".next", "BUILD_ID"),
        path.join(layout.greenData, "xiryn.db"),
        path.join(layout.greenData, "skills", "demo", "SKILL.md"),
        path.join(layout.blueData, "xiryn.db"),
      ]
      for (const file of owned) {
        assert.equal(fs.statSync(file).uid, uid, file)
      }
      assert.equal(
        fs.readFileSync(
          path.join(layout.greenData, "skills", "demo", "SKILL.md"),
          "utf8"
        ),
        "skill\n"
      )
      assert.equal(fs.existsSync(path.join(layout.greenData, "backups")), false)
      assert.equal(fs.existsSync(path.join(layout.greenData, "vault-live.key")), false)
      assert.equal(fs.existsSync(path.join(layout.greenData, ".env")), false)

      const readable = serviceArgv(USER, [
        "/usr/bin/test",
        "-r",
        path.join(layout.greenData, "xiryn.db"),
      ])
      execFileSync(readable[0], readable.slice(1), {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: home,
          USER,
          LOGNAME: USER,
          NODE_ENV: "production",
        },
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
