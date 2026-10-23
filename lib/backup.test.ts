import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"

import {
  createBackup,
  describeVaultKey,
  parseBackupArgs,
  restoreBackup,
  verifyBackup,
  type VaultKeyInfo,
} from "./backup"

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

function sha256(file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function treeContains(dir: string, needle: string) {
  const pending = [dir]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(abs)
      else if (entry.isFile() && fs.readFileSync(abs).includes(needle)) return true
    }
  }
  return false
}

function noKey(dataDir: string): VaultKeyInfo {
  return describeVaultKey({
    dataDir,
    env: {},
    homeDir: path.join(dataDir, "unused-home"),
    platform: "linux",
    docker: false,
    probe: () => false,
  })
}

function seed(root: string) {
  const dataDir = path.join(root, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, "xiryn.db")
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("wal_autocheckpoint = 0")
  db.exec("create table notes (body text)")
  db.prepare("insert into notes (body) values (?)").run("from-wal")
  fs.writeFileSync(path.join(dataDir, "mcp.json"), '{"servers":[]}\n', { mode: 0o600 })
  fs.mkdirSync(path.join(dataDir, "nested"))
  fs.writeFileSync(path.join(dataDir, "nested", "extra.txt"), "extra")
  return { dataDir, dbPath, db }
}

async function withRoot(run: (root: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-backup-"))
  try {
    await run(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("online backup keeps committed rows and skips the live WAL", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const outside = path.join(root, "outside-secret.txt")
    fs.writeFileSync(outside, "outside-secret")
    fs.symlinkSync(outside, path.join(dataDir, "linked.txt"))
    const outDir = path.join(root, "out")
    const now = new Date("2026-10-23T16:36:05.000Z")
    const result = await createBackup({
      dataDir,
      outDir,
      now,
      vault: noKey(dataDir),
      version: "9.9.9",
    })
    assert.equal(path.basename(result.directory), "xiryn-20261023-163605")
    assert.equal(fs.existsSync(path.join(dataDir, "xiryn.db-wal")), true)
    assert.equal(fs.existsSync(path.join(result.directory, "xiryn.db-wal")), false)
    assert.equal(fs.existsSync(path.join(result.directory, "xiryn.db-shm")), false)
    assert.equal(fs.existsSync(path.join(result.directory, "linked.txt")), false)
    assert.equal(treeContains(result.directory, "outside-secret"), false)
    assert.equal(
      fs.readFileSync(path.join(result.directory, "mcp.json"), "utf8"),
      '{"servers":[]}\n'
    )
    assert.equal(
      fs.readFileSync(path.join(result.directory, "nested", "extra.txt"), "utf8"),
      "extra"
    )
    assert.equal(result.manifest.version, "9.9.9")
    assert.equal(result.manifest.timestamp, "2026-10-23T16:36:05.000Z")
    const dbEntry = result.manifest.files.find((file) => file.path === "xiryn.db")
    assert.ok(dbEntry)
    assert.equal(dbEntry.sha256, sha256(path.join(result.directory, "xiryn.db")))
    assert.equal(fs.statSync(result.directory).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(result.directory, "xiryn.db")).mode & 0o777, 0o600)

    const target = path.join(root, "restored")
    fs.mkdirSync(target)
    await restoreBackup({ directory: result.directory, target, liveDataDir: dataDir })
    const restored = new Database(path.join(target, "xiryn.db"), { readonly: true })
    const row = restored.prepare("select body from notes").get() as { body: string }
    restored.close()
    db.close()
    assert.equal(row.body, "from-wal")
  })
})

test("verify checks sha256 and fails when a file is tampered", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const result = await createBackup({
      dataDir,
      outDir: path.join(root, "out"),
      now: new Date("2026-02-02T00:00:00.000Z"),
      vault: noKey(dataDir),
    })
    db.close()
    const verified = await verifyBackup(result.directory)
    assert.equal(verified.files, result.manifest.files.length)

    fs.appendFileSync(path.join(result.directory, "mcp.json"), " ")
    await assert.rejects(async () => verifyBackup(result.directory), /mcp\.json/)
  })
})

test("verify rejects a manifest path that escapes the backup", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const result = await createBackup({
      dataDir,
      outDir: path.join(root, "out"),
      now: new Date("2026-02-03T00:00:00.000Z"),
      vault: noKey(dataDir),
    })
    db.close()
    const manifestPath = path.join(result.directory, "manifest.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      files: { path: string; sha256: string }[]
    }
    manifest.files.push({ path: "../outside.txt", sha256: "a".repeat(64) })
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    await assert.rejects(async () => verifyBackup(result.directory), /outside\.txt/)
  })
})

test("keep deletes older backups and leaves the newest", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const outDir = path.join(root, "out")
    fs.mkdirSync(outDir)
    fs.writeFileSync(path.join(outDir, "notes.txt"), "leave me")
    const vault = noKey(dataDir)
    const first = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-03-01T00:00:00.000Z"),
      vault,
      keep: 2,
    })
    const second = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-03-02T00:00:00.000Z"),
      vault,
      keep: 2,
    })
    const third = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-03-03T00:00:00.000Z"),
      vault,
      keep: 2,
    })
    db.close()
    assert.equal(fs.existsSync(first.directory), false)
    assert.equal(fs.existsSync(second.directory), true)
    assert.equal(fs.existsSync(third.directory), true)
    assert.equal(fs.readFileSync(path.join(outDir, "notes.txt"), "utf8"), "leave me")
    const names = fs
      .readdirSync(outDir)
      .filter((name) => name.startsWith("xiryn-"))
      .sort()
    assert.deepEqual(names, [
      path.basename(second.directory),
      path.basename(third.directory),
    ])
  })
})

test("restore refuses a non-empty target and the live data directory", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const result = await createBackup({
      dataDir,
      outDir: path.join(root, "out"),
      now: new Date("2026-04-01T00:00:00.000Z"),
      vault: noKey(dataDir),
    })
    const target = path.join(root, "target")
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, "keep.txt"), "stay")
    await assert.rejects(
      async () =>
        restoreBackup({ directory: result.directory, target, liveDataDir: dataDir }),
      /non-empty/
    )
    assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "stay")
    assert.equal(fs.readdirSync(target).length, 1)

    await assert.rejects(
      async () =>
        restoreBackup({
          directory: result.directory,
          target: dataDir,
          liveDataDir: dataDir,
        }),
      /live data directory/
    )
    const live = new Database(path.join(dataDir, "xiryn.db"), { readonly: true })
    const row = live.prepare("select body from notes").get() as { body: string }
    live.close()
    db.close()
    assert.equal(row.body, "from-wal")
  })
})

test("vault key file is excluded unless --include-vault-key", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const home = path.join(root, "home")
    const located = describeVaultKey({
      dataDir,
      env: {},
      homeDir: home,
      platform: "linux",
      docker: false,
      probe: () => false,
    })
    fs.mkdirSync(path.dirname(located.filePath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(located.filePath, "file-key-secret", { mode: 0o600 })
    const vault = describeVaultKey({
      dataDir,
      env: {},
      homeDir: home,
      platform: "linux",
      docker: false,
      probe: () => false,
    })
    assert.equal(vault.source, "file")
    const outDir = path.join(root, "out")
    const hidden = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-05-01T00:00:00.000Z"),
      vault,
      includeVaultKey: false,
    })
    assert.equal(hidden.vaultKeyIncluded, false)
    const notice = hidden.notices.join("\n")
    assert.match(notice, /does not include the vault key/)
    assert.match(notice, /Google refresh token/)
    assert.doesNotMatch(notice, /file-key-secret/)
    assert.equal(treeContains(hidden.directory, "file-key-secret"), false)
    assert.ok(notice.includes(vault.filePath))

    const included = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-05-02T00:00:00.000Z"),
      vault,
      includeVaultKey: true,
    })
    db.close()
    const copied = path.join(included.directory, path.basename(vault.filePath))
    assert.equal(included.vaultKeyIncluded, true)
    assert.equal(fs.readFileSync(copied, "utf8"), "file-key-secret")
    assert.equal(fs.statSync(copied).mode & 0o777, 0o600)
    assert.match(included.notices.join("\n"), /sensitive/)

    const dockerLocated = describeVaultKey({
      dataDir,
      env: {},
      homeDir: home,
      platform: "linux",
      docker: true,
      probe: () => false,
    })
    assert.equal(path.dirname(dockerLocated.filePath), path.resolve(dataDir))
    fs.writeFileSync(dockerLocated.filePath, "docker-key-secret", { mode: 0o600 })
    const dockerVault = describeVaultKey({
      dataDir,
      env: {},
      homeDir: home,
      platform: "linux",
      docker: true,
      probe: () => false,
    })
    assert.equal(dockerVault.source, "file")
    const dockerBackup = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-05-03T00:00:00.000Z"),
      vault: dockerVault,
    })
    assert.equal(dockerBackup.vaultKeyIncluded, false)
    assert.equal(treeContains(dockerBackup.directory, "docker-key-secret"), false)
  })
})

test("environment and keychain keys are reported and never written", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const secret = Buffer.alloc(32, 7).toString("base64")
    const home = path.join(root, "home")
    const vault = describeVaultKey({
      dataDir,
      env: { XIRYN_VAULT_KEY: secret },
      homeDir: home,
      platform: "linux",
      docker: false,
      probe: () => false,
    })
    assert.equal(vault.source, "env")
    fs.mkdirSync(path.dirname(vault.filePath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(vault.filePath, "stale-file-key")
    const envBackup = await createBackup({
      dataDir,
      outDir: path.join(root, "out"),
      now: new Date("2026-06-01T00:00:00.000Z"),
      vault,
      includeVaultKey: true,
    })
    assert.equal(vault.source, "env")
    assert.equal(envBackup.vaultKeyIncluded, false)
    assert.match(envBackup.notices.join("\n"), /XIRYN_VAULT_KEY/)
    assert.equal(envBackup.notices.join("\n").includes(secret), false)
    assert.equal(treeContains(envBackup.directory, secret), false)
    assert.equal(treeContains(envBackup.directory, "stale-file-key"), false)

    const keychain = describeVaultKey({
      dataDir,
      env: {},
      homeDir: home,
      platform: "darwin",
      docker: false,
      probe: (kind) => kind === "keychain",
    })
    assert.equal(keychain.source, "keychain")
    const keychainBackup = await createBackup({
      dataDir,
      outDir: path.join(root, "out"),
      now: new Date("2026-06-02T00:00:00.000Z"),
      vault: keychain,
      includeVaultKey: true,
    })
    db.close()
    assert.equal(keychainBackup.vaultKeyIncluded, false)
    assert.match(keychainBackup.notices.join("\n"), /Keychain/)
    assert.match(keychainBackup.notices.join("\n"), /not written/)
    assert.equal(treeContains(keychainBackup.directory, "stale-file-key"), false)
  })
})

test("a backup directory inside the data directory is not copied into itself", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    const outDir = path.join(dataDir, "backups")
    const vault = noKey(dataDir)
    await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-07-01T00:00:00.000Z"),
      vault,
    })
    const second = await createBackup({
      dataDir,
      outDir,
      now: new Date("2026-07-02T00:00:00.000Z"),
      vault,
    })
    db.close()
    assert.equal(
      second.manifest.files.some((file) => file.path.startsWith("backups/")),
      false
    )
    assert.equal(treeContains(second.directory, "xiryn-20260701-000000"), false)
  })
})

test("parse backup arguments", () => {
  assert.deepEqual(parseBackupArgs([]), {
    kind: "create",
    includeVaultKey: false,
  })
  assert.deepEqual(
    parseBackupArgs(["--out", "data/backups", "--keep", "4", "--include-vault-key"]),
    {
      kind: "create",
      out: "data/backups",
      keep: 4,
      includeVaultKey: true,
    }
  )
  assert.deepEqual(parseBackupArgs(["verify", "data/backups/xiryn-20260101-000000"]), {
    kind: "verify",
    dir: "data/backups/xiryn-20260101-000000",
  })
  assert.deepEqual(
    parseBackupArgs([
      "restore",
      "data/backups/xiryn-20260101-000000",
      "--target",
      "/tmp/empty",
    ]),
    {
      kind: "restore",
      dir: "data/backups/xiryn-20260101-000000",
      target: "/tmp/empty",
    }
  )
  assert.throws(() => parseBackupArgs(["--keep", "0"]), /positive integer/)
  assert.throws(() => parseBackupArgs(["restore", "somewhere"]), /--target/)
})

test("the backup command verifies and restores", async () => {
  await withRoot(async (root) => {
    const { dataDir, db } = seed(root)
    db.close()
    const outDir = path.join(root, "out")
    const keyDir = path.join(root, "keys")
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 })
    const env = { ...process.env }
    delete env.XIRYN_VAULT_KEY
    env.XIRYN_DATA_DIR = dataDir
    env.XIRYN_VAULT_KEY_DIR = keyDir
    const run = (args: string[]) =>
      spawnSync("node", ["--import", "tsx", "scripts/backup.ts", ...args], {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      })

    const created = run(["--out", outDir, "--keep", "3"])
    assert.equal(created.status, 0, created.stderr)
    const directory = created.stdout.trim().split("\n").at(-1)!
    assert.equal(fs.existsSync(path.join(directory, "manifest.json")), true)
    assert.match(created.stderr, /vault key/)
    assert.equal(created.stderr.includes("file-key-secret"), false)

    const verified = run(["verify", directory])
    assert.equal(verified.status, 0, verified.stderr)
    assert.match(verified.stdout, /ok/i)

    const target = path.join(root, "restored")
    const restored = run(["restore", directory, "--target", target])
    assert.equal(restored.status, 0, restored.stderr)
    const copy = new Database(path.join(target, "xiryn.db"), { readonly: true })
    const row = copy.prepare("select body from notes").get() as { body: string }
    copy.close()
    assert.equal(row.body, "from-wal")

    const refused = run(["restore", directory, "--target", dataDir])
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /live data directory/)
  })
})
