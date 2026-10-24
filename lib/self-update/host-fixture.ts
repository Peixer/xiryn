import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const HELPER_SCRIPTS = [
  "self-update-snapshot.mjs",
  "self-update-migrate.mjs",
  "self-update-approval.mjs",
] as const

const NODE_PACKAGES = ["better-sqlite3", "bindings", "file-uri-to-path", "drizzle-orm"]

function readableTree(dir: string) {
  const stat = fs.lstatSync(dir)
  if (stat.isSymbolicLink()) throw new Error(`${dir} is a symlink`)
  if (stat.isDirectory()) {
    fs.chmodSync(dir, 0o755)
    for (const name of fs.readdirSync(dir)) readableTree(path.join(dir, name))
    return
  }
  fs.chmodSync(dir, 0o644)
}

// Copies the helper scripts, migrations, and the packages they import into
// the temp root. The service user cannot read a mode-750 checkout, so the
// colour tree must not symlink back to the repo.
export function installHelperRuntime(root: string, repo = process.cwd()) {
  const runtime = path.join(root, "runtime")
  fs.mkdirSync(path.join(runtime, "scripts"), { recursive: true, mode: 0o755 })
  for (const name of HELPER_SCRIPTS) {
    fs.copyFileSync(path.join(repo, "scripts", name), path.join(runtime, "scripts", name))
  }
  fs.cpSync(path.join(repo, "db", "migrations"), path.join(runtime, "db", "migrations"), {
    recursive: true,
    dereference: true,
  })
  const modules = path.join(root, "node_modules")
  fs.mkdirSync(modules, { recursive: true, mode: 0o755 })
  for (const name of NODE_PACKAGES) {
    fs.cpSync(path.join(repo, "node_modules", name), path.join(modules, name), {
      recursive: true,
      dereference: true,
    })
  }
  readableTree(runtime)
  readableTree(modules)
  return runtime
}

export function copyHelperTree(colourDir: string, runtime: string) {
  const scripts = path.join(colourDir, "scripts")
  fs.mkdirSync(scripts, { recursive: true, mode: 0o755 })
  fs.chmodSync(colourDir, 0o755)
  fs.chmodSync(scripts, 0o755)
  for (const name of HELPER_SCRIPTS) {
    const dest = path.join(scripts, name)
    fs.copyFileSync(path.join(runtime, "scripts", name), dest)
    fs.chmodSync(dest, 0o644)
    const stat = fs.lstatSync(dest)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${dest} must be a regular file`)
    }
  }
  const migrations = path.join(colourDir, "db", "migrations")
  fs.rmSync(migrations, { recursive: true, force: true })
  fs.cpSync(path.join(runtime, "db", "migrations"), migrations, {
    recursive: true,
    dereference: true,
  })
  readableTree(path.join(colourDir, "db"))
}

export function resolveUseradd() {
  for (const candidate of ["/usr/sbin/useradd", "/sbin/useradd"]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Try the next absolute path, then sudo's command -v.
    }
  }
  const found = spawnSync(
    "sudo",
    ["-n", "env", "PATH=/usr/sbin:/sbin:/usr/bin:/bin", "sh", "-c", "command -v useradd"],
    { encoding: "utf8" }
  )
  const bin = found.stdout.trim()
  if (
    found.status === 0 &&
    bin.startsWith("/") &&
    !bin.includes("\n") &&
    !bin.includes(" ")
  ) {
    return bin
  }
  return null
}

export function privilegeGap(): { useradd: string } | { skip: string } {
  const sudo = spawnSync("sudo", ["-n", "true"], { encoding: "utf8" })
  if (sudo.error || sudo.status !== 0) return { skip: "passwordless sudo is unavailable" }
  const useradd = resolveUseradd()
  if (!useradd) return { skip: "useradd is unavailable" }
  return { useradd }
}

export function ensureServiceUser(name: string, useradd: string) {
  if (!useradd.startsWith("/")) throw new Error("useradd must be an absolute path")
  if (spawnSync("id", [name]).status === 0) return
  const added = spawnSync(useradd, [
    "--create-home",
    "--shell",
    "/usr/sbin/nologin",
    "--user-group",
    name,
  ])
  if (added.status !== 0 && spawnSync("id", [name]).status !== 0) {
    throw new Error(added.stderr?.toString() || "useradd failed")
  }
}
