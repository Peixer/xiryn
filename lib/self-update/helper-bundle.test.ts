import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const repo = path.join(import.meta.dirname, "../..")

function runInstaller(env: Record<string, string>) {
  return spawnSync("bash", ["deploy/migrate-blue-green.sh"], {
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, NODE_ENV: "production", ...env },
  })
}

test("the committed helper bundle matches a fresh build", () => {
  const out = path.join(os.tmpdir(), `xiryn-helper-bundle-${process.pid}.mjs`)
  const result = spawnSync(process.execPath, ["scripts/bundle-xiryn-helper.mjs", out], {
    encoding: "utf8",
    cwd: repo,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  try {
    const fresh = fs.readFileSync(out, "utf8")
    const committed = fs.readFileSync(path.join(repo, "deploy/xiryn-helper.mjs"), "utf8")
    assert.equal(
      fresh,
      committed,
      "deploy/xiryn-helper.mjs is stale. Run: npm run bundle:helper"
    )
    assert.doesNotMatch(committed, /from\s+["']@\//)
    assert.doesNotMatch(committed, /node_modules/)
  } finally {
    fs.rmSync(out, { force: true })
  }
})

test("a re-run installs the helper before it reports blue/green is already installed", () => {
  const src = fs.readFileSync(path.join(repo, "deploy/migrate-blue-green.sh"), "utf8")
  const marker = 'echo "Blue/green is already installed'
  const at = src.indexOf(marker)
  assert.notEqual(at, -1)
  const blockStart = src.lastIndexOf('if [[ -f "$ACTIVE"', at)
  assert.notEqual(blockStart, -1)
  const block = src.slice(blockStart, at)
  assert.match(block, /\n\s*install_helper\n/)
  assert.match(block, /\n\s*refresh_deploy_path\n/)
})

test("the installed helper runs outside the repo and refuses a colour-tree program", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-helper-"))
  const bin = path.join(root, "sbin", "xiryn-helper")
  const lib = path.join(root, "lib")
  const deploy = path.join(root, "deploy")
  const cwd = path.join(root, "cwd")
  fs.mkdirSync(cwd)
  try {
    const installed = runInstaller({
      XIRYN_HELPER_ONLY: "1",
      XIRYN_HELPER_BIN: bin,
      XIRYN_HELPER_LIB_DIR: lib,
    })
    assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`)
    assert.equal(
      fs.readFileSync(path.join(lib, "xiryn-helper.mjs"), "utf8"),
      fs.readFileSync(path.join(repo, "deploy/xiryn-helper.mjs"), "utf8")
    )
    assert.equal(fs.existsSync(path.join(lib, "xiryn-helper.ts")), false)
    assert.equal(fs.statSync(bin).mode & 0o111, 0o111)

    fs.writeFileSync(
      path.join(lib, "xiryn-helper.ts"),
      'import { parseHelperRequest } from "@/lib/self-update/allowlist"\n'
    )
    const again = runInstaller({
      XIRYN_HELPER_ONLY: "1",
      XIRYN_HELPER_BIN: bin,
      XIRYN_HELPER_LIB_DIR: lib,
    })
    assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`)
    assert.equal(fs.existsSync(path.join(lib, "xiryn-helper.ts")), false)

    const inbox = path.join(deploy, "inbox")
    fs.mkdirSync(inbox, { recursive: true })
    fs.writeFileSync(path.join(inbox, "1-status.json"), "{")
    const ran = spawnSync(bin, [], {
      encoding: "utf8",
      cwd,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: root,
        NODE_ENV: "production",
        XIRYN_HELPER_BUNDLE: path.join(lib, "xiryn-helper.mjs"),
        XIRYN_HELPER_NODE: process.execPath,
        XIRYN_DEPLOY_DIR: deploy,
        XIRYN_DEPLOY_CONF: path.join(root, "no-such.conf"),
        TSX_TSCONFIG_PATH: path.join(root, "no-tsconfig.json"),
        NODE_OPTIONS: "--import /nonexistent/xiryn-loader.mjs",
        NODE_PATH: path.join(repo, "node_modules"),
      },
    })
    assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`)
    assert.doesNotMatch(
      `${ran.stdout}\n${ran.stderr}`,
      /Cannot find module|Cannot find package/
    )
    assert.notEqual(path.resolve(cwd), path.resolve(repo))
    assert.equal(fs.existsSync(path.join(inbox, "1-status.json")), false)
    const progress = fs.readFileSync(path.join(deploy, "progress.jsonl"), "utf8")
    assert.match(progress, /refused/)
    assert.match(progress, /not JSON/)

    const refused = spawnSync(bin, [], {
      encoding: "utf8",
      cwd,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: root,
        NODE_ENV: "production",
        XIRYN_HELPER_BUNDLE: "/opt/xiryn-blue/xiryn-helper.mjs",
        XIRYN_HELPER_NODE: process.execPath,
      },
    })
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr ?? "", /colour tree/)

    const refusedNode = spawnSync(bin, [], {
      encoding: "utf8",
      cwd,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: root,
        NODE_ENV: "production",
        XIRYN_HELPER_BUNDLE: path.join(lib, "xiryn-helper.mjs"),
        XIRYN_HELPER_NODE: "/opt/xiryn-green/node_modules/.bin/tsx",
      },
    })
    assert.notEqual(refusedNode.status, 0)
    assert.match(refusedNode.stderr ?? "", /colour tree/)

    const args = spawnSync(bin, ["status"], {
      encoding: "utf8",
      cwd,
      env: { PATH: "/usr/bin:/bin", HOME: root, NODE_ENV: "production" },
    })
    assert.equal(args.status, 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
