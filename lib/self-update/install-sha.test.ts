import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { ensureServiceUser, privilegeGap } from "./host-fixture"

const CHILD = process.env.XIRYN_SHA_CHILD === "1"
const USER = "xirynsha"

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
  "the installer reads a commit from a tree owned by another user",
  { skip: CHILD, timeout: 60_000 },
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
        "XIRYN_SHA_CHILD=1",
        `XIRYN_USERADD=${gap.useradd}`,
        process.execPath,
        "--import",
        "tsx",
        "--test",
        "lib/self-update/install-sha.test.ts",
      ],
      { encoding: "utf8", cwd: process.cwd() }
    )
    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
      assert.fail(output || `sha child exited ${result.status}`)
    }
  }
)

test(
  "deployed_sha uses safe.directory when the tree owner is not root",
  { skip: !CHILD, timeout: 60_000 },
  () => {
    assert.equal(process.getuid?.(), 0)
    ensureServiceUser(USER, process.env.XIRYN_USERADD ?? "")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynsha"))
    const work = path.join(root, "tree")
    fs.mkdirSync(work)
    const env = gitEnv("/root")
    const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", env })
    try {
      git(["init", "-b", "main", work])
      fs.writeFileSync(path.join(work, "README"), "hi\n")
      git(["-C", work, "add", "README"])
      git(["-C", work, "commit", "-m", "one"])
      const sha = git(["-C", work, "rev-parse", "HEAD"]).trim()
      execFileSync("chown", ["-R", `${USER}:${USER}`, work])
      const plain = spawnSync("git", ["-C", work, "rev-parse", "--verify", "HEAD"], {
        encoding: "utf8",
        env,
      })
      assert.notEqual(plain.status, 0)
      assert.match(plain.stderr, /dubious ownership/i)

      const recorded = spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...env, XIRYN_SHA_ONLY: "1", XIRYN_SHA_TREE: work },
      })
      assert.equal(recorded.status, 0, `${recorded.stdout}\n${recorded.stderr}`)
      assert.equal(recorded.stdout.trim(), sha)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
