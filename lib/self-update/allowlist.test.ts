import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { commandAllowed, HELPER_OPS, parseHelperRequest, serviceArgv } from "./allowlist"
import { DEFAULT_LAYOUT } from "./layout"

const SHA = "a".repeat(40)
const when = "2026-10-24T08:00:00.000Z"

test("the helper accepts only prepare, switch, rollback, and status", () => {
  assert.deepEqual([...HELPER_OPS], ["prepare", "switch", "rollback", "status"])
  const ok = parseHelperRequest({
    op: "prepare",
    sha: SHA,
    approvalId: null,
    actor: "owner",
    requestedAt: when,
  })
  assert.equal(ok.ok, true)

  assert.equal(
    parseHelperRequest({ op: "bash", actor: "owner", requestedAt: when }).ok,
    false
  )
  assert.equal(
    parseHelperRequest({
      op: "prepare",
      sha: "main",
      actor: "owner",
      requestedAt: when,
    }).ok,
    false
  )
  assert.equal(
    parseHelperRequest({
      op: "switch",
      sha: SHA,
      actor: "owner",
      requestedAt: when,
    }).ok,
    false
  )
  assert.equal(
    parseHelperRequest({
      op: "prepare",
      sha: SHA,
      actor: "agent",
      requestedAt: when,
    }).ok,
    false
  )
  assert.equal(
    parseHelperRequest({
      op: "status",
      sha: SHA,
      actor: "owner",
      requestedAt: when,
    }).ok,
    false
  )
  assert.equal(
    parseHelperRequest({
      op: "prepare",
      sha: SHA,
      actor: "owner",
      requestedAt: when,
      command: "rm -rf /",
    }).ok,
    false
  )
})

test("spawned commands are pinned to the layout", () => {
  const layout = DEFAULT_LAYOUT
  assert.equal(
    commandAllowed(
      [
        "git",
        "--git-dir",
        layout.mirror,
        "fetch",
        "--prune",
        "origin",
        `+refs/heads/${layout.branch}:refs/heads/${layout.branch}`,
      ],
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(["git", "-C", layout.greenDir, "checkout", "--detach", SHA], layout),
    false
  )
  const pack = `git -c safe.directory=${layout.mirror} upload-pack`
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-c",
        `safe.directory=${layout.mirror}`,
        "clone",
        "--no-checkout",
        "--upload-pack",
        pack,
        layout.mirror,
        layout.greenDir,
      ]),
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-c",
        `safe.directory=${layout.mirror}`,
        "clone",
        "--no-checkout",
        layout.mirror,
        layout.greenDir,
      ]),
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", ["git", "-C", layout.greenDir, "checkout", "--detach", SHA]),
      layout
    ),
    true
  )
  const pinRef = `+refs/heads/${layout.branch}:refs/remotes/pin/${layout.branch}`
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-C",
        layout.greenDir,
        "-c",
        `safe.directory=${layout.mirror}`,
        "fetch",
        "--upload-pack",
        pack,
        layout.mirror,
        pinRef,
      ]),
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-C",
        layout.greenDir,
        "-c",
        `safe.directory=${layout.mirror}`,
        "fetch",
        "--upload-pack",
        "git upload-pack",
        layout.mirror,
        pinRef,
      ]),
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-C",
        layout.greenDir,
        "fetch",
        layout.mirror,
        pinRef,
      ]),
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-C",
        layout.blueDir,
        "-c",
        `safe.directory=${layout.mirror}`,
        "fetch",
        "origin",
        pinRef,
      ]),
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "git",
        "-C",
        layout.blueDir,
        "-c",
        `safe.directory=${layout.mirror}`,
        "fetch",
        layout.mirror,
        `+refs/heads/${layout.branch}:refs/heads/${layout.branch}`,
      ]),
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("root", ["git", "-C", layout.greenDir, "checkout", "--detach", SHA]),
      layout,
      "root"
    ),
    false
  )
  assert.equal(commandAllowed(["bash", "-c", "reboot"], layout), false)
  assert.equal(commandAllowed(["sudo", "systemctl", "restart", "xiryn"], layout), false)
  assert.equal(commandAllowed(["systemctl", "restart", "xiryn"], layout), false)
  assert.equal(commandAllowed(["systemctl", "start", "xiryn-green"], layout), true)
  assert.equal(commandAllowed(["systemctl", "stop", "nginx"], layout), false)
  assert.equal(
    commandAllowed(["git", "-C", layout.blueDir, "checkout", "--detach", "main"], layout),
    false
  )
  assert.equal(
    commandAllowed(["git", "-C", "/tmp/evil", "checkout", "--detach", SHA], layout),
    false
  )
  assert.equal(
    commandAllowed(["npm", "--prefix", layout.blueDir, "run", "build"], layout),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", ["npm", "--prefix", layout.blueDir, "run", "build"]),
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "npm",
        "--prefix",
        layout.blueDir,
        "ci",
        "--include=dev",
        "--no-audit",
        "--no-fund",
      ]),
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(["npm", "--prefix", layout.blueDir, "run", "something-else"], layout),
    false
  )
  const snapshot = [
    "node",
    "/usr/local/lib/xiryn/self-update-snapshot.mjs",
    "--from",
    layout.blueData,
    "--to",
  ]
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        ...snapshot,
        `${layout.deployDir}/staging/2026-10-24T10-00-00-000Z-prepare`,
      ]),
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        ...snapshot,
        `${layout.backupDir}/2026-10-24T10-00-00-000Z-prepare`,
      ]),
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      [
        "/usr/bin/node",
        "/usr/local/lib/xiryn/self-update-lock.mjs",
        "--db",
        `${layout.blueData}/xiryn.db`,
      ],
      layout
    ),
    true
  )
  assert.equal(
    commandAllowed(
      [
        "node",
        "/usr/local/lib/xiryn/self-update-lock.mjs",
        "--db",
        `${layout.blueData}/xiryn.db`,
      ],
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      [
        "/usr/bin/node",
        "/opt/xiryn-blue/scripts/self-update-lock.mjs",
        "--db",
        `${layout.blueData}/xiryn.db`,
      ],
      layout
    ),
    false
  )
  assert.equal(
    commandAllowed(
      serviceArgv("xiryn", [
        "/usr/bin/node",
        "/usr/local/lib/xiryn/self-update-lock.mjs",
        "--db",
        `${layout.blueData}/xiryn.db`,
      ]),
      layout
    ),
    false
  )
})

test("the oneshot is started by a path unit and takes no arguments", () => {
  const root = path.join(import.meta.dirname, "../../deploy")
  const unit = fs.readFileSync(path.join(root, "xiryn-deploy.service"), "utf8")
  const watch = fs.readFileSync(path.join(root, "xiryn-deploy.path"), "utf8")
  const wrapper = fs.readFileSync(path.join(root, "xiryn-helper"), "utf8")
  assert.match(unit, /^ExecStart=\/usr\/local\/sbin\/xiryn-helper$/m)
  assert.match(watch, /PathExistsGlob=\/var\/lib\/xiryn\/deploy\/inbox\/\*\.json/)
  assert.match(wrapper, /\$# -ne 0/)
  assert.match(wrapper, /\/usr\/bin\/node/)
  assert.match(wrapper, /xiryn-helper\.mjs/)
  assert.match(wrapper, /colour tree/)
  assert.doesNotMatch(wrapper, /node_modules\/\.bin\/tsx/)
  assert.doesNotMatch(unit, /sudo/)
  assert.match(unit, /^ProtectHome=read-only$/m)
  assert.match(unit, /^ReadWritePaths=.*\/var\/lib\/xiryn\/deploy\/npm-cache/m)
  assert.match(unit, /\/var\/lib\/xiryn\/deploy\/cache/)
  assert.match(unit, /\/var\/lib\/xiryn\/deploy\/config/)
  assert.match(unit, /\/var\/lib\/xiryn\/deploy\/staging/)
})
