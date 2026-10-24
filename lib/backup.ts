import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"

import { vaultAccount } from "@/lib/vault-account"

// A consistent copy of the data directory.
//
// SQLite's online backup API writes the snapshot, so the live WAL and shared-
// memory files are never copied. The vault key is not part of that directory
// on a normal host (see lib/vault.ts). It is left out unless asked for, and
// even then only a file-based key is copied. A key that lives in the
// environment or the operating-system store is reported and never written.

const VAULT_SERVICE = "xiryn-vault"
const VAULT_KEY_NAME = /^vault-[0-9a-f]{16}\.key$/
const BACKUP_DIR_NAME = /^xiryn-\d{8}-\d{6}(?:-\d+)?$/

export type VaultKeySource =
  "env" | "keychain" | "dpapi" | "secret-service" | "file" | "none"

export type VaultKeyInfo = {
  source: VaultKeySource
  filePath: string
  filePresent: boolean
}

export type BackupManifest = {
  version: string
  timestamp: string
  files: { path: string; sha256: string }[]
}

export type BackupResult = {
  directory: string
  manifest: BackupManifest
  notices: string[]
  vaultKeyIncluded: boolean
}

export type BackupCommand =
  | { kind: "create"; out?: string; keep?: number; includeVaultKey: boolean }
  | { kind: "verify"; dir: string }
  | { kind: "restore"; dir: string; target: string }

export class BackupError extends Error {
  name = "BackupError"
  constructor(message: string) {
    super(message)
  }
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(env.XIRYN_DATA_DIR || "data")
}

export function defaultOutDir(dataDir: string) {
  return path.join(path.resolve(dataDir), "backups")
}

// Same file the vault module would read. That module is not imported here:
// loading it constructs the live database client.
export function describeVaultKey(input: {
  dataDir: string
  env: Record<string, string | undefined>
  homeDir: string
  platform: NodeJS.Platform
  docker: boolean
  probe?: (kind: "keychain" | "secret-service", account: string) => boolean
}): VaultKeyInfo {
  const dataDir = path.resolve(input.dataDir)
  const dbPath = path.join(dataDir, "xiryn.db")
  const account = vaultAccount(dbPath, input.env.XIRYN_VAULT_ACCOUNT)
  const keyDir = input.env.XIRYN_VAULT_KEY_DIR
    ? path.resolve(input.env.XIRYN_VAULT_KEY_DIR)
    : input.docker
      ? dataDir
      : path.resolve(input.homeDir, ".xiryn")
  const filePath = path.join(keyDir, `vault-${account}.key`)
  const filePresent = fileHasKey(filePath)
  const probe = input.probe ?? defaultProbe

  if (isEnvKey(input.env.XIRYN_VAULT_KEY)) {
    return { source: "env", filePath, filePresent }
  }
  if (input.platform === "darwin" && probe("keychain", account)) {
    return { source: "keychain", filePath, filePresent }
  }
  if (
    input.platform === "win32" &&
    fs.existsSync(path.join(dataDir, "vault.key.dpapi"))
  ) {
    return { source: "dpapi", filePath, filePresent }
  }
  if (input.platform === "linux" && probe("secret-service", account)) {
    return { source: "secret-service", filePath, filePresent }
  }
  if (filePresent) return { source: "file", filePath, filePresent }
  return { source: "none", filePath, filePresent }
}

export function parseBackupArgs(argv: string[]): BackupCommand {
  if (argv.length === 0) return { kind: "create", includeVaultKey: false }
  if (argv[0] === "verify") {
    if (argv.length !== 2 || !argv[1] || argv[1].startsWith("-")) {
      throw new BackupError("Usage: npm run backup -- verify <dir>")
    }
    return { kind: "verify", dir: argv[1] }
  }
  if (argv[0] === "restore") return parseRestore(argv.slice(1))
  return parseCreate(argv)
}

export async function createBackup(options: {
  dataDir: string
  outDir: string
  keep?: number
  includeVaultKey?: boolean
  now?: Date
  vault: VaultKeyInfo
  version?: string
}): Promise<BackupResult> {
  const dataDir = path.resolve(options.dataDir)
  const outDir = path.resolve(options.outDir)
  const now = options.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new BackupError("Invalid backup time")
  if (options.keep !== undefined && !isKeep(options.keep)) {
    throw new BackupError("--keep needs a positive integer")
  }
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    throw new BackupError(`Data directory does not exist: ${dataDir}`)
  }
  if (samePath(outDir, dataDir)) {
    throw new BackupError(
      "The backup directory must not be the data directory. Use a subdirectory such as data/backups."
    )
  }
  const dbPath = path.join(dataDir, "xiryn.db")
  const dbStat = fs.existsSync(dbPath) ? fs.lstatSync(dbPath) : null
  if (!dbStat || dbStat.isSymbolicLink() || !dbStat.isFile()) {
    throw new BackupError(`No database at ${dbPath}`)
  }

  fs.mkdirSync(outDir, { recursive: true })
  let created: string | undefined
  let result: BackupResult | undefined
  try {
    const directory = reserveBackupDir(outDir, now)
    created = directory
    await backupDatabase(dbPath, path.join(directory, "xiryn.db"))
    const copied = copyDataFiles(dataDir, directory, outDir)
    let vaultKeyIncluded = false
    if (options.includeVaultKey && options.vault.source === "file") {
      copyVaultKey(options.vault.filePath, directory)
      copied.push(path.basename(options.vault.filePath))
      vaultKeyIncluded = true
    }
    const files = [...new Set(copied)].sort().map((relative) => ({
      path: relative,
      sha256: sha256File(path.join(directory, ...relative.split("/"))),
    }))
    const manifest: BackupManifest = {
      version: options.version ?? readAppVersion(),
      timestamp: now.toISOString(),
      files,
    }
    fs.writeFileSync(path.join(directory, "manifest.json"), manifestJson(manifest), {
      mode: 0o600,
    })
    fs.chmodSync(path.join(directory, "manifest.json"), 0o600)
    result = {
      directory,
      manifest,
      notices: vaultNotices(options.vault, !!options.includeVaultKey, vaultKeyIncluded),
      vaultKeyIncluded,
    }
  } catch (error) {
    if (created) fs.rmSync(created, { recursive: true, force: true })
    if (error instanceof BackupError) throw error
    throw new BackupError(error instanceof Error ? error.message : "Backup failed")
  }
  if (options.keep !== undefined) pruneBackups(outDir, options.keep)
  return result
}

export function verifyBackup(directory: string): { files: number } {
  const backupDir = path.resolve(directory)
  const manifest = readManifest(backupDir)
  const problems: string[] = []
  const present = listRegularFiles(backupDir, problems)
  const listed = new Set<string>()
  if (!manifest.files.some((file) => file.path === "xiryn.db")) {
    problems.push("manifest is missing xiryn.db")
  }
  for (const file of manifest.files) {
    if (listed.has(file.path)) problems.push(`${file.path}: listed more than once`)
    listed.add(file.path)
    const abs = path.join(backupDir, ...file.path.split("/"))
    if (!isInside(backupDir, abs) || samePath(backupDir, abs)) {
      problems.push(`${file.path}: invalid path`)
      continue
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      problems.push(`${file.path}: missing`)
      continue
    }
    if (sha256File(abs) !== file.sha256) problems.push(`${file.path}: hash mismatch`)
  }
  for (const found of present) {
    if (!listed.has(found)) problems.push(`${found}: not in the manifest`)
  }
  if (problems.length > 0) {
    throw new BackupError(`Backup verify failed:\n${problems.join("\n")}`)
  }
  return { files: manifest.files.length }
}

export function restoreBackup(options: {
  directory: string
  target: string
  liveDataDir: string
}): { target: string; notices: string[] } {
  const backupDir = path.resolve(options.directory)
  const target = path.resolve(options.target)
  const live = path.resolve(options.liveDataDir)
  if (samePath(target, live) || isInside(target, live)) {
    throw new BackupError("Refusing to restore over the live data directory")
  }
  if (
    samePath(target, backupDir) ||
    isInside(backupDir, target) ||
    isInside(target, backupDir)
  ) {
    throw new BackupError("Refusing to restore into the backup directory")
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new BackupError("Restore target has to be an empty directory")
    }
    if (fs.readdirSync(target).length > 0) {
      throw new BackupError("Refusing to restore into a non-empty directory")
    }
  }

  const manifest = readManifest(backupDir)
  verifyBackup(backupDir)

  fs.mkdirSync(target, { recursive: true })
  fs.chmodSync(target, 0o700)
  for (const file of manifest.files) {
    const src = path.join(backupDir, ...file.path.split("/"))
    const dest = path.join(target, ...file.path.split("/"))
    if (!isInside(target, dest) || samePath(target, dest)) {
      throw new BackupError(`Invalid backup path: ${file.path}`)
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
    fs.chmodSync(dest, 0o600)
  }

  const notices: string[] = []
  const keyFile = manifest.files.find((file) =>
    VAULT_KEY_NAME.test(path.posix.basename(file.path))
  )
  if (keyFile) {
    notices.push(
      `WARNING: A vault key file was restored into the target as ${keyFile.path} (mode 0600).`,
      "It was not installed over the live key. Move it to the vault key directory, or set XIRYN_VAULT_KEY_DIR to the target, before starting Xiryn.",
      "This file is sensitive."
    )
  }
  return { target, notices }
}

function parseCreate(argv: string[]): BackupCommand {
  let out: string | undefined
  let keep: number | undefined
  let includeVaultKey = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--include-vault-key") {
      includeVaultKey = true
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      out = arg === "--out" ? argv[++i] : arg.slice("--out=".length)
      if (!out) throw new BackupError("--out needs a directory")
    } else if (arg === "--keep" || arg.startsWith("--keep=")) {
      keep = parseKeep(arg === "--keep" ? argv[++i] : arg.slice("--keep=".length))
    } else {
      throw new BackupError(`Unknown argument: ${arg}`)
    }
  }
  return {
    kind: "create",
    includeVaultKey,
    ...(out !== undefined ? { out } : {}),
    ...(keep !== undefined ? { keep } : {}),
  }
}

function parseRestore(argv: string[]): BackupCommand {
  let dir: string | undefined
  let target: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--target" || arg.startsWith("--target=")) {
      target = arg === "--target" ? argv[++i] : arg.slice("--target=".length)
      if (!target) throw new BackupError("--target needs an empty directory")
    } else if (arg.startsWith("-")) {
      throw new BackupError(`Unknown argument: ${arg}`)
    } else if (!dir) {
      dir = arg
    } else {
      throw new BackupError("Usage: npm run backup -- restore <dir> --target <empty-dir>")
    }
  }
  if (!dir || !target) {
    throw new BackupError("Usage: npm run backup -- restore <dir> --target <empty-dir>")
  }
  return { kind: "restore", dir, target }
}

function parseKeep(value: string | undefined) {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    throw new BackupError("--keep needs a positive integer")
  }
  return Number(value)
}

function isKeep(value: number) {
  return Number.isInteger(value) && value >= 1
}

function isEnvKey(value: string | undefined) {
  if (!value?.trim()) return false
  const key = Buffer.from(value.trim(), "base64")
  const ok = key.length === 32
  key.fill(0)
  return ok
}

function fileHasKey(filePath: string) {
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) return false
    const buffer = Buffer.alloc(256)
    const fd = fs.openSync(filePath, "r")
    try {
      const read = fs.readSync(fd, buffer, 0, buffer.length, 0)
      return buffer.subarray(0, read).toString("utf8").trim().length > 0
    } finally {
      buffer.fill(0)
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

// Status only. stdout is discarded so a keychain secret never enters this process.
function defaultProbe(kind: "keychain" | "secret-service", account: string) {
  const command = kind === "keychain" ? "security" : "secret-tool"
  const args =
    kind === "keychain"
      ? ["find-generic-password", "-s", VAULT_SERVICE, "-a", account]
      : ["lookup", "service", VAULT_SERVICE, "account", account]
  const result = spawnSync(command, args, {
    stdio: "ignore",
    timeout: 5_000,
    windowsHide: true,
  })
  return result.status === 0
}

function readAppVersion() {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url))
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown }
  if (typeof pkg.version !== "string" || !pkg.version) {
    throw new BackupError("package.json has no version")
  }
  return pkg.version
}

function stamp(now: Date) {
  const part = (value: number) => String(value).padStart(2, "0")
  return [
    `${now.getUTCFullYear()}${part(now.getUTCMonth() + 1)}${part(now.getUTCDate())}`,
    `${part(now.getUTCHours())}${part(now.getUTCMinutes())}${part(now.getUTCSeconds())}`,
  ].join("-")
}

function reserveBackupDir(outDir: string, now: Date) {
  const base = `xiryn-${stamp(now)}`
  for (let n = 1; n <= 1000; n++) {
    const name = n === 1 ? base : `${base}-${n}`
    const dest = path.join(outDir, name)
    try {
      fs.mkdirSync(dest)
      fs.chmodSync(dest, 0o700)
      return dest
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
  throw new BackupError("Too many backups with the same timestamp")
}

async function backupDatabase(source: string, destination: string) {
  const db = new Database(source, { readonly: true, fileMustExist: true, timeout: 5_000 })
  try {
    await db.backup(destination)
  } finally {
    db.close()
  }
  fs.chmodSync(destination, 0o600)
}

function copyDataFiles(dataDir: string, destDir: string, outDir: string) {
  const copied: string[] = ["xiryn.db"]
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const abs = path.join(dir, entry.name)
      if (skipPath(dataDir, outDir, destDir, abs, entry.name)) continue
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      const relative = path.relative(dataDir, abs).split(path.sep).join("/")
      assertSafeRelative(relative)
      const target = path.join(destDir, ...relative.split("/"))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(abs, target)
      fs.chmodSync(target, 0o600)
      copied.push(relative)
    }
  }
  walk(dataDir)
  return copied
}

function skipPath(
  dataDir: string,
  outDir: string,
  destDir: string,
  abs: string,
  name: string
) {
  if (VAULT_KEY_NAME.test(name)) return true
  // The new archive, and the whole backup folder when it lives inside the
  // data directory. An --out path that merely contains the data directory
  // is not skipped, or every data file would be left out.
  if (isInside(destDir, abs)) return true
  if (isInside(dataDir, outDir) && !samePath(dataDir, outDir) && isInside(outDir, abs)) {
    return true
  }
  if (path.dirname(abs) !== dataDir) return false
  return (
    name === "xiryn.db" ||
    name === "xiryn.db-wal" ||
    name === "xiryn.db-shm" ||
    name === "xiryn.db-journal"
  )
}

function copyVaultKey(filePath: string, destDir: string) {
  const name = path.basename(filePath)
  if (!VAULT_KEY_NAME.test(name) || !fileHasKey(filePath)) {
    throw new BackupError(`No file-based vault key at ${filePath}`)
  }
  const target = path.join(destDir, name)
  if (fs.existsSync(target)) {
    throw new BackupError(`Backup already contains ${name}`)
  }
  fs.copyFileSync(filePath, target)
  fs.chmodSync(target, 0o600)
}

function pruneBackups(outDir: string, keep: number) {
  const names = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BACKUP_DIR_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
  for (const name of names.slice(keep)) {
    fs.rmSync(path.join(outDir, name), { recursive: true, force: true })
  }
}

function vaultNotices(vault: VaultKeyInfo, include: boolean, included: boolean) {
  if (vault.source === "file" && included) {
    return [
      "WARNING: The vault key was copied into this backup (mode 0600).",
      "This backup is sensitive. Anyone who can read it can decrypt vault items and the Google refresh token.",
    ]
  }
  if (vault.source === "file") {
    return [
      "WARNING: This backup does not include the vault key.",
      "Vault items and the Google refresh token cannot be decrypted without it.",
      `The key file was not copied: ${vault.filePath}`,
      "Run again with --include-vault-key to copy it. That makes the backup sensitive.",
    ]
  }
  if (vault.source === "env") {
    return [
      "NOTE: The vault key comes from XIRYN_VAULT_KEY and was not written into the backup.",
      "Without that value, vault items and the Google refresh token cannot be decrypted.",
      ...(include
        ? [
            "WARNING: --include-vault-key only copies a file-based key. The environment value was not written.",
          ]
        : []),
    ]
  }
  if (
    vault.source === "keychain" ||
    vault.source === "dpapi" ||
    vault.source === "secret-service"
  ) {
    const where =
      vault.source === "keychain"
        ? "the macOS Keychain"
        : vault.source === "dpapi"
          ? "Windows DPAPI"
          : "the Linux Secret Service"
    return [
      `NOTE: The vault key is in ${where} and was not written into the backup.`,
      "Without that key, vault items and the Google refresh token cannot be decrypted on another machine.",
      ...(include
        ? [
            "WARNING: --include-vault-key only copies a file-based key. This key was not written.",
          ]
        : []),
    ]
  }
  return [
    "NOTE: No vault key was found, so none was copied.",
    `Expected a file at ${vault.filePath}, or XIRYN_VAULT_KEY, or an operating-system key store.`,
    "Without the key, vault items and the Google refresh token cannot be decrypted.",
  ]
}

function readManifest(backupDir: string): BackupManifest {
  const manifestPath = path.join(backupDir, "manifest.json")
  if (!fs.existsSync(manifestPath))
    throw new BackupError("No manifest.json in this backup")
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch {
    throw new BackupError("manifest.json is not valid JSON")
  }
  if (!parsed || typeof parsed !== "object")
    throw new BackupError("manifest.json is not valid")
  const manifest = parsed as Partial<BackupManifest>
  if (typeof manifest.version !== "string" || !manifest.version) {
    throw new BackupError("manifest is missing version")
  }
  if (typeof manifest.timestamp !== "string" || !manifest.timestamp) {
    throw new BackupError("manifest is missing timestamp")
  }
  if (!Array.isArray(manifest.files))
    throw new BackupError("manifest is missing the file list")
  const files = manifest.files.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new BackupError("manifest file list is invalid")
    }
    assertSafeRelative(entry.path)
    return { path: entry.path, sha256: entry.sha256 }
  })
  return { version: manifest.version, timestamp: manifest.timestamp, files }
}

function assertSafeRelative(relative: string) {
  if (
    !relative ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  ) {
    throw new BackupError(`Invalid backup path: ${relative}`)
  }
  const parts = relative.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new BackupError(`Invalid backup path: ${relative}`)
  }
}

function listRegularFiles(root: string, problems: string[]) {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      const relative = path.relative(root, abs).split(path.sep).join("/")
      if (entry.isSymbolicLink()) {
        problems.push(`${relative}: symlink`)
        continue
      }
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      if (!entry.isFile()) {
        problems.push(`${relative}: not a regular file`)
        continue
      }
      if (relative !== "manifest.json") files.push(relative)
    }
  }
  walk(root)
  return files
}

function manifestJson(manifest: BackupManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function sha256File(file: string) {
  const hash = createHash("sha256")
  const fd = fs.openSync(file, "r")
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest("hex")
}

function real(file: string) {
  const abs = path.resolve(file)
  try {
    return fs.realpathSync(abs)
  } catch {
    return abs
  }
}

function samePath(a: string, b: string) {
  return real(a) === real(b)
}

function isInside(parent: string, child: string) {
  const rel = path.relative(real(parent), real(child))
  if (rel === "") return true
  if (path.isAbsolute(rel)) return false
  return !rel.split(path.sep).includes("..")
}
