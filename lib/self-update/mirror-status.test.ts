import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { loadSelfUpdateView } from "@/lib/self-update/status"

const CHILD = process.env.XIRYN_MIRROR_CHILD === "1"

function gitEnv(home: string, extra: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    NODE_ENV: "production" as const,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  }
}

test("status reads a root-owned pin mirror", { skip: CHILD, timeout: 60_000 }, (t) => {
  const sudo = spawnSync("sudo", ["-n", "true"], { encoding: "utf8" })
  if (sudo.error || sudo.status !== 0) {
    t.skip("passwordless sudo is unavailable")
    return
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynmirror"))
  const home = path.join(root, "home")
  const work = path.join(root, "work")
  const mirror = path.join(root, "pin.git")
  const deploy = path.join(root, "deploy")
  const conf = path.join(root, "deploy.conf")
  fs.mkdirSync(home)
  fs.mkdirSync(deploy)
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", env: gitEnv(home) })
  git(["init", "-b", "main", work])
  git(["-C", work, "config", "user.email", "test@example.com"])
  git(["-C", work, "config", "user.name", "test"])
  fs.writeFileSync(path.join(work, "README"), "one\n")
  git(["-C", work, "add", "README"])
  git(["-C", work, "commit", "-m", "one"])
  const first = git(["-C", work, "rev-parse", "HEAD"]).trim()
  fs.appendFileSync(path.join(work, "README"), "two\n")
  git(["-C", work, "add", "README"])
  git(["-C", work, "commit", "-m", "two"])
  const tip = git(["-C", work, "rev-parse", "HEAD"]).trim()
  git(["clone", "--bare", work, mirror])
  const owned = spawnSync("sudo", ["-n", "chown", "-R", "root:root", mirror, work], {
    encoding: "utf8",
  })
  assert.equal(owned.status, 0, owned.stderr)
  fs.writeFileSync(conf, `BRANCH=main\nMIRROR=${mirror}\n`)
  fs.writeFileSync(
    path.join(deploy, "state.json"),
    `${JSON.stringify({
      phase: "active",
      active: "blue",
      activeSha: first,
      branch: "main",
      baseline: "active",
    })}\n`
  )
  const realGit = execFileSync("bash", ["-c", "command -v git"], {
    encoding: "utf8",
    env: gitEnv(home),
  }).trim()
  const gitLog = path.join(root, "git.log")
  const wrap = path.join(root, "bin")
  fs.mkdirSync(wrap)
  fs.writeFileSync(
    path.join(wrap, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${gitLog}'\nexec '${realGit}' "$@"\n`
  )
  fs.chmodSync(path.join(wrap, "git"), 0o755)
  // Git refuses a repository it discovered and does not own. -c safe.directory
  // is the exception the status reader passes for the root-owned mirror.
  const discovered = spawnSync(realGit, ["status"], {
    encoding: "utf8",
    cwd: work,
    env: gitEnv(home),
  })
  try {
    assert.notEqual(discovered.status, 0)
    assert.match(`${discovered.stderr ?? ""}`, /dubious ownership/i)
    const allowed = spawnSync(realGit, ["-c", `safe.directory=${work}`, "status"], {
      encoding: "utf8",
      cwd: work,
      env: gitEnv(home),
    })
    assert.equal(allowed.status, 0, allowed.stderr)
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "lib/self-update/mirror-status.test.ts"],
      {
        encoding: "utf8",
        cwd: process.cwd(),
        env: gitEnv(home, {
          PATH: `${wrap}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          XIRYN_MIRROR_CHILD: "1",
          XIRYN_DEPLOY_CONF: conf,
          XIRYN_DEPLOY_DIR: deploy,
          XIRYN_EXPECT_SHA: tip,
        }),
      }
    )
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
    const calls = fs.readFileSync(gitLog, "utf8")
    assert.equal(calls.includes(`-c safe.directory=${mirror}`), true, calls)
    assert.equal(calls.includes("rev-parse"), true, calls)
    assert.equal(calls.includes(" log "), true, calls)
    assert.equal(calls.includes(" diff "), true, calls)
  } finally {
    spawnSync("sudo", ["-n", "rm", "-rf", root])
  }
})

test("the service user can read the root-owned mirror", { skip: !CHILD }, () => {
  const view = loadSelfUpdateView()
  assert.equal(view.tipSha, process.env.XIRYN_EXPECT_SHA)
  assert.equal(view.updateAvailable, true)
  assert.equal(view.titles.length > 0, true)
})
