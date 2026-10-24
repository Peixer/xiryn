import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { describeVaultKey } from "@/lib/backup"
import { vaultAccount } from "@/lib/vault-account"

const CHILD = process.env.XIRYN_VAULT_CHILD ?? ""
const SECRET = "colour-stable"

test(
  "a child creates a vault item under the old database path",
  { skip: CHILD !== "create" },
  async () => {
    const { sqlite } = await import("@/db")
    const { addVaultItem } = await import("@/lib/vault")
    const item = addVaultItem("code", { code: SECRET })
    sqlite.pragma("wal_checkpoint(TRUNCATE)")
    fs.writeFileSync(process.env.XIRYN_VAULT_RESULT ?? "", `${item.id}\n`)
  }
)

test(
  "a child opens the vault with the pinned account",
  { skip: CHILD !== "open" },
  async () => {
    const { vaultValue } = await import("@/lib/vault")
    assert.equal(vaultValue(process.env.XIRYN_VAULT_ITEM ?? "", "code"), SECRET)
  }
)

test("the vault account stays on the key created for the old database", () => {
  const oldDb = "/opt/xiryn/data/xiryn.db"
  const blueDb = "/var/lib/xiryn/colours/blue/xiryn.db"
  const greenDb = "/var/lib/xiryn/colours/green/xiryn.db"
  const account = vaultAccount(oldDb)
  assert.equal(vaultAccount(blueDb, account), account)
  assert.equal(vaultAccount(greenDb, account), account)
  assert.notEqual(vaultAccount(blueDb), account)
  assert.notEqual(vaultAccount(greenDb), vaultAccount(blueDb))
  assert.equal(vaultAccount(blueDb, "not-a-name"), vaultAccount(blueDb))
  const described = describeVaultKey({
    dataDir: path.dirname(blueDb),
    env: { XIRYN_VAULT_ACCOUNT: account },
    homeDir: "/home/xiryn",
    platform: "linux",
    docker: false,
    probe: () => false,
  })
  assert.equal(path.basename(described.filePath), `vault-${account}.key`)
})

test(
  "both colours open vault items created under the old database path",
  { skip: CHILD !== "", timeout: 60_000 },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirynvault"))
    const oldData = path.join(root, "opt", "data")
    const blueData = path.join(root, "colours", "blue")
    const greenData = path.join(root, "colours", "green")
    const keyDir = path.join(root, "vault")
    const result = path.join(root, "item-id")
    const fakeBin = path.join(root, "bin")
    fs.mkdirSync(fakeBin)
    fs.writeFileSync(path.join(fakeBin, "secret-tool"), "#!/bin/sh\nexit 1\n")
    fs.chmodSync(path.join(fakeBin, "secret-tool"), 0o755)
    const oldDb = path.join(oldData, "xiryn.db")
    const account = vaultAccount(oldDb)
    // A nested `node --test` inherits the runner's context and exits without
    // running the file. Pass only the variables this child needs.
    const baseEnv: Record<string, string> = {
      PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: process.env.HOME ?? os.tmpdir(),
      TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
      NODE_ENV: "production",
      XIRYN_VAULT_KEY_DIR: keyDir,
    }
    const spawnChild = (
      child: "create" | "open",
      dataDir: string,
      extra: Record<string, string>
    ) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "--test", "lib/vault-account.test.ts"],
        {
          encoding: "utf8",
          cwd: process.cwd(),
          env: {
            ...baseEnv,
            ...extra,
            XIRYN_VAULT_CHILD: child,
            XIRYN_DATA_DIR: dataDir,
            NODE_ENV: "production",
          },
        }
      )
    try {
      const created = spawnChild("create", oldData, { XIRYN_VAULT_RESULT: result })
      assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`)
      const id = fs.readFileSync(result, "utf8").trim()
      assert.match(id, /^[0-9a-f]{12}$/)
      const keyName = `vault-${account}.key`
      assert.equal(fs.existsSync(path.join(keyDir, keyName)), true)
      fs.cpSync(oldData, blueData, { recursive: true })
      fs.cpSync(oldData, greenData, { recursive: true })
      for (const dataDir of [blueData, greenData]) {
        const opened = spawnChild("open", dataDir, {
          XIRYN_VAULT_ACCOUNT: account,
          XIRYN_VAULT_ITEM: id,
        })
        assert.equal(opened.status, 0, `${dataDir}\n${opened.stdout}\n${opened.stderr}`)
      }
      const names = fs.readdirSync(keyDir).filter((name) => name.startsWith("vault-"))
      assert.deepEqual(names, [keyName])
      assert.notEqual(vaultAccount(path.join(blueData, "xiryn.db")), account)
      assert.notEqual(vaultAccount(path.join(greenData, "xiryn.db")), account)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
