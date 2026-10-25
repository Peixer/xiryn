import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { commandAllowed, serviceArgv } from "./allowlist"
import { DEFAULT_LAYOUT } from "./layout"
import { createSystemHost } from "./system-host"

test("cutover persists the active colour atomically and reverses unit enablement on rollback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-cutover-"))
  const oldPath = process.env.PATH
  try {
    const calls = path.join(root, "calls")
    fs.writeFileSync(
      path.join(root, "systemctl"),
      `#!/bin/sh\nprintf '%s %s\\n' "$1" "$2" >> '${calls}'\n`,
      { mode: 0o755 }
    )
    process.env.PATH = `${root}:${oldPath}`
    const host = createSystemHost({
      ...DEFAULT_LAYOUT,
      deployDir: root,
      maintenanceFile: path.join(root, "maintenance"),
    })
    host.activateColour("green")
    assert.equal(fs.readFileSync(path.join(root, "active"), "utf8"), "green\n")
    assert.equal(fs.existsSync(path.join(root, "active.tmp")), false)
    host.activateColour("blue")
    assert.equal(fs.readFileSync(path.join(root, "active"), "utf8"), "blue\n")
    assert.deepEqual(fs.readFileSync(calls, "utf8").trim().split("\n"), [
      "enable xiryn-green",
      "disable xiryn-blue",
      "enable xiryn-blue",
      "disable xiryn-green",
    ])
  } finally {
    process.env.PATH = oldPath
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("ending maintenance removes stale acknowledgements for both colours even without a maintenance file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-quiesce-"))
  try {
    const host = createSystemHost({
      ...DEFAULT_LAYOUT,
      deployDir: root,
      maintenanceFile: path.join(root, "maintenance"),
    })
    for (const maintenance of [true, false]) {
      if (maintenance) host.setMaintenance(true)
      for (const colour of ["blue", "green"])
        fs.writeFileSync(
          path.join(root, `quiesce-${colour}.json`),
          '{"workers":"stopped"}'
        )
      host.setMaintenance(false)
      assert.deepEqual(fs.readdirSync(root), [])
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("helper allowlist permits dev dependencies and only colour enablement", () => {
  assert.ok(
    commandAllowed(
      serviceArgv("xiryn", [
        "npm",
        "--prefix",
        DEFAULT_LAYOUT.greenDir,
        "ci",
        "--include=dev",
        "--no-audit",
        "--no-fund",
      ]),
      DEFAULT_LAYOUT
    )
  )
  for (const op of ["enable", "disable"]) {
    assert.ok(commandAllowed(["systemctl", op, "xiryn-blue"], DEFAULT_LAYOUT))
    assert.equal(commandAllowed(["systemctl", op, "sshd.service"], DEFAULT_LAYOUT), false)
  }
})

test("installer enables only the serving colour and installs Caddy ordering without restarting it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-installer-"))
  try {
    fs.writeFileSync(
      path.join(root, "systemctl"),
      '#!/bin/sh\necho "$*" >> "$XIRYN_TEST_CALLS"\n',
      { mode: 0o755 }
    )
    const calls = path.join(root, "calls")
    const result = spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        XIRYN_TEST_CALLS: calls,
        XIRYN_ENABLE_ONLY: "green",
        XIRYN_CADDY_DROPIN_DIR: path.join(root, "caddy.service.d"),
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      fs.readFileSync(calls, "utf8"),
      "enable xiryn-green.service\ndisable xiryn-blue.service\n"
    )
    assert.match(
      fs.readFileSync(path.join(root, "caddy.service.d/10-tailscale.conf"), "utf8"),
      /After=tailscaled.service/
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("build retries clear .next and install dev dependencies without a production ci environment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-build-"))
  const oldPath = process.env.PATH
  const oldUser = process.env.XIRYN_SERVICE_USER
  try {
    const account = os.userInfo()
    if (account.username === "root") return // root environments use the production fixture
    process.env.XIRYN_SERVICE_USER = account.username
    process.env.PATH = `${root}:${oldPath}`
    fs.writeFileSync(
      path.join(root, "setpriv"),
      '#!/bin/sh\nwhile [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n',
      { mode: 0o755 }
    )
    const dest = path.join(root, "green")
    fs.mkdirSync(path.join(dest, ".next/cache"), { recursive: true })
    fs.writeFileSync(path.join(dest, ".next/cache/stale"), "stale")
    fs.writeFileSync(
      path.join(root, "npm"),
      `#!/bin/sh
set -eu
[ "$1" = --prefix ]
prefix=$2
if [ "$3" = ci ]; then
  [ "$4" = --include=dev ]
  [ "$NODE_ENV" != production ]
  [ ! -e "$prefix/.next" ]
  echo ci >> '${root}/calls'
else
  [ "$NODE_ENV" = production ]
  mkdir -p "$prefix/.next/cache"
  echo build >> '${root}/calls'
  if [ ! -f '${root}/failed-once' ]; then
    touch '${root}/failed-once' "$prefix/.next/cache/stale"
    exit 1
  fi
  touch "$prefix/.next/BUILD_ID"
fi
`,
      { mode: 0o755 }
    )
    const host = createSystemHost({
      ...DEFAULT_LAYOUT,
      deployDir: path.join(root, "deploy"),
      greenDir: dest,
    })
    assert.throws(() => host.installAndBuild(dest))
    assert.ok(fs.existsSync(path.join(dest, ".next/cache/stale")))
    host.installAndBuild(dest)
    assert.equal(fs.existsSync(path.join(dest, ".next/cache/stale")), false)
    assert.ok(fs.existsSync(path.join(dest, ".next/BUILD_ID")))
    assert.equal(
      fs.readFileSync(path.join(root, "calls"), "utf8"),
      "ci\nbuild\nci\nbuild\n"
    )
  } finally {
    process.env.PATH = oldPath
    if (oldUser === undefined) delete process.env.XIRYN_SERVICE_USER
    else process.env.XIRYN_SERVICE_USER = oldUser
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("installer trusts deploy state over an old active label without switching colour", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-active-"))
  try {
    const state = path.join(root, "state.json")
    const active = path.join(root, "active")
    fs.writeFileSync(state, '{"active":"green"}')
    fs.writeFileSync(active, "blue\n")
    const result = spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        XIRYN_ACTIVE_ONLY: "1",
        XIRYN_STATE_FILE: state,
        XIRYN_ACTIVE_FILE: active,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "green")
    assert.equal(fs.readFileSync(active, "utf8"), "blue\n")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const BUILDX_STATE_DIR = "/var/lib/xiryn/docker/buildx"

test("colour and legacy units give buildx a writable config dir without opening the home directory", () => {
  for (const file of ["xiryn-blue.service", "xiryn-green.service", "xiryn.service"]) {
    const unit = fs.readFileSync(path.join("deploy", file), "utf8")
    assert.match(unit, /^ProtectHome=read-only$/m, file)
    assert.match(unit, /^ProtectSystem=strict$/m, file)
    assert.match(
      unit,
      new RegExp(`^Environment=BUILDX_CONFIG=${BUILDX_STATE_DIR}$`, "m"),
      file
    )
    assert.match(
      unit,
      new RegExp(`^ReadWritePaths=.*${BUILDX_STATE_DIR}( |$)`, "m"),
      file
    )
    assert.doesNotMatch(unit, /\/home\/xiryn/, file)
  }
  const deploy = fs.readFileSync("deploy/xiryn-deploy.service", "utf8")
  assert.doesNotMatch(deploy, /BUILDX_CONFIG/)
  assert.doesNotMatch(deploy, /\/var\/lib\/xiryn\/docker\/buildx/)
})

test("installer creates the buildx state directory idempotently and does not restart a colour", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-buildx-"))
  const state = path.join(root, "docker", "buildx")
  const calls = path.join(root, "calls")
  try {
    fs.writeFileSync(
      path.join(root, "systemctl"),
      `#!/bin/sh\necho "$*" >> '${calls}'\n`,
      { mode: 0o755 }
    )
    const env = {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      XIRYN_BUILDX_ONLY: "1",
      XIRYN_BUILDX_STATE: state,
    }
    const first = spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
      encoding: "utf8",
      env,
    })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(fs.statSync(state).isDirectory(), true)
    assert.equal(fs.statSync(state).mode & 0o777, 0o700)
    fs.writeFileSync(path.join(state, "keep"), "keep")
    const second = spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
      encoding: "utf8",
      env,
    })
    assert.equal(second.status, 0, second.stderr)
    assert.equal(fs.readFileSync(path.join(state, "keep"), "utf8"), "keep")
    assert.equal(fs.statSync(state).mode & 0o777, 0o700)
    assert.equal(fs.existsSync(calls), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  const source = fs.readFileSync("deploy/migrate-blue-green.sh", "utf8")
  assert.match(source, /XIRYN_BUILDX_STATE:-\/var\/lib\/xiryn\/docker\/buildx/)
  assert.match(source, /install_runtime_dirs\(\) \{[\s\S]*?install_buildx_state/)
  const already = source.slice(
    source.indexOf('if [[ ( -f "$ACTIVE"'),
    source.indexOf('if [[ ! -d "$ROOT" ]]')
  )
  assert.match(already, /install_runtime_dirs/)
  assert.doesNotMatch(already, /systemctl restart xiryn-(blue|green|)\.service/)
  const docs = fs.readFileSync("docs/self-update.md", "utf8")
  assert.match(docs, /20-docker-config\.conf/)
  assert.match(docs, /\/var\/lib\/xiryn\/docker\/buildx/)
})
