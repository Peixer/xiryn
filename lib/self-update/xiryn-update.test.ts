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

test("xiryn-update is executable, syntax-clean, and only asks the helper for status", () => {
  const file = "deploy/xiryn-update"
  const script = fs.readFileSync(path.join(repo, file), "utf8")
  assert.equal(fs.statSync(path.join(repo, file)).mode & 0o111, 0o111)
  const indexed = spawnSync("git", ["ls-files", "-s", "--", file], {
    cwd: repo,
    encoding: "utf8",
  })
  assert.equal(indexed.status, 0, indexed.stderr)
  assert.match(indexed.stdout, /^100755 /, "deploy/xiryn-update must be mode 755 in git")

  for (const target of [file, "deploy/migrate-blue-green.sh"]) {
    const syntax = spawnSync("bash", ["-n", target], { cwd: repo, encoding: "utf8" })
    assert.equal(syntax.status, 0, `${target}\n${syntax.stderr}`)
  }

  assert.match(script, /\[ "\$\(id -u\)" -eq 0 \] \|\| exec sudo "\$0" "\$@"/)
  assert.match(
    script,
    /\{"op":"status","sha":null,"approvalId":null,"actor":"owner","requestedAt":"%s"\}/
  )
  assert.match(script, /install -o xiryn -g xiryn -m 0600/)
  assert.doesNotMatch(script, /"op":"(prepare|switch|rollback)"/)
  assert.match(script, /Pedido de status enviado, esperando o helper\.\.\./)
  assert.match(script, /O helper não pegou o pedido em 60s\. Veja: xiryn-update logs/)
  assert.match(
    script,
    /Pronto\. Agora abra Settings, clique em Update, espere ficar ready e aprove o Switch\./
  )
  assert.match(script, /\/opt\/xiryn já está na main/)
  assert.match(script, /deploy\/ não mudou, não precisa do instalador\./)
  assert.match(script, /deploy\/ mudou, rodando o instalador\.\.\./)
  assert.match(script, /REPO=\/opt\/xiryn\nDEPLOY=\/var\/lib\/xiryn\/deploy\n/)
})

test("shellcheck accepts xiryn-update and the blue/green installer", (t) => {
  const found = spawnSync("bash", ["-lc", "command -v shellcheck"], { encoding: "utf8" })
  if (found.status !== 0) {
    t.skip("shellcheck is not installed")
    return
  }
  const result = spawnSync(
    "shellcheck",
    ["deploy/xiryn-update", "deploy/migrate-blue-green.sh"],
    { cwd: repo, encoding: "utf8" }
  )
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test("the installer copies xiryn-update to mode 0755 and a second run replaces it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-update-"))
  const bin = path.join(root, "sbin", "xiryn-update")
  const env = { XIRYN_UPDATE_ONLY: "1", XIRYN_UPDATE_BIN: bin }
  try {
    const first = runInstaller(env)
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const expected = fs.readFileSync(path.join(repo, "deploy/xiryn-update"))
    assert.deepEqual(fs.readFileSync(bin), expected)
    assert.equal(fs.statSync(bin).mode & 0o777, 0o755)
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      const st = fs.statSync(bin)
      assert.equal(st.uid, 0)
      assert.equal(st.gid, 0)
    }

    fs.writeFileSync(bin, "stale\n")
    fs.chmodSync(bin, 0o644)
    const second = runInstaller(env)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.deepEqual(fs.readFileSync(bin), expected)
    assert.equal(fs.statSync(bin).mode & 0o777, 0o755)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("a re-run and a first install both install xiryn-update", () => {
  const src = fs.readFileSync(path.join(repo, "deploy/migrate-blue-green.sh"), "utf8")
  const marker = 'echo "Blue/green is already installed'
  const at = src.indexOf(marker)
  assert.notEqual(at, -1)
  const blockStart = src.lastIndexOf('if [[ ( -f "$ACTIVE"', at)
  assert.notEqual(blockStart, -1)
  const block = src.slice(blockStart, at)
  assert.match(block, /\n\s*install_xiryn_update\n/)

  const first = src.slice(src.lastIndexOf("\ninstall_helper\n"))
  assert.match(first, /^\ninstall_helper\ninstall_xiryn_update\n/)
  assert.match(src, /bin="\$\{XIRYN_UPDATE_BIN:-\/usr\/local\/sbin\/xiryn-update\}"/)
  assert.match(src, /install -m 0755 "\$SRC\/xiryn-update" "\$bin"/)
  assert.match(src, /chown root:root "\$bin"/)
})
