import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

// Holds a reserved lock on one colour database until the helper says
// "release". Root runs this file from /usr/local/lib/xiryn. Node resolves
// better-sqlite3 next to it, from the root-owned copy the installer made.
// The service user cannot replace this script or that module, and cannot
// kill the root process that holds the lock.

const here = fileURLToPath(import.meta.url)

function owned(file, kind) {
  let stat
  try {
    stat = fs.lstatSync(file)
  } catch {
    return false
  }
  if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) return false
  return kind === "dir" ? stat.isDirectory() : stat.isFile()
}

// Checked before the native module is loaded. A non-root test run uses the
// module next to this checkout and does not have to live at the install path.
if (typeof process.getuid === "function" && process.getuid() === 0) {
  let resolved = here
  try {
    resolved = fs.realpathSync(here)
  } catch {
    resolved = ""
  }
  const lib = "/usr/local/lib/xiryn"
  const modules = path.join(lib, "node_modules")
  const sqlite = path.join(modules, "better-sqlite3")
  const trusted =
    resolved === path.join(lib, "self-update-lock.mjs") &&
    owned(resolved, "file") &&
    owned(lib, "dir") &&
    owned(modules, "dir") &&
    owned(sqlite, "dir") &&
    owned(path.join(sqlite, "build", "Release", "better_sqlite3.node"), "file") &&
    owned(path.join(modules, "bindings"), "dir") &&
    owned(path.join(modules, "file-uri-to-path"), "dir")
  if (!trusted) {
    process.stderr.write("lock script is not the root-owned copy\n")
    process.exit(1)
  }
}

const Database = createRequire(here)("better-sqlite3")

const dbFlag = process.argv.indexOf("--db")
const dbPath = process.argv[dbFlag + 1]
if (
  process.argv.length !== 4 ||
  dbFlag !== 2 ||
  !dbPath ||
  !dbPath.startsWith("/") ||
  dbPath.includes("..") ||
  !dbPath.endsWith("/xiryn.db")
) {
  process.stderr.write("lock needs --db /path/xiryn.db\n")
  process.exit(2)
}

let sqlite
try {
  sqlite = new Database(dbPath)
  sqlite.pragma("busy_timeout = 30000")
  sqlite.exec("BEGIN IMMEDIATE")
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

function serviceIds() {
  try {
    const text = fs.readFileSync("/etc/passwd", "utf8")
    for (const line of text.split("\n")) {
      const [user, , uidText, gidText] = line.split(":")
      if (user !== "xiryn") continue
      const uid = Number(uidText)
      const gid = Number(gidText)
      if (!Number.isInteger(uid) || uid < 0) return null
      return { uid, gid }
    }
  } catch {
    return null
  }
  return null
}

// A root connection can create the WAL sidecars. Hand them back so the
// service user can keep writing after the lock is released.
function handBack(file) {
  let stat
  try {
    stat = fs.lstatSync(file)
  } catch {
    return
  }
  if (stat.isSymbolicLink() || stat.uid !== 0) return
  const ids = serviceIds()
  if (!ids) return
  try {
    fs.chownSync(file, ids.uid, ids.gid)
  } catch {
    // Not root. The lock is still held.
  }
}

handBack(dbPath)
handBack(`${dbPath}-wal`)
handBack(`${dbPath}-shm`)

let released = false
function release() {
  if (released) return
  released = true
  handBack(dbPath)
  handBack(`${dbPath}-wal`)
  handBack(`${dbPath}-shm`)
  try {
    sqlite.exec("ROLLBACK")
  } catch {
    // The process exit drops the lock if the rollback already happened.
  }
  try {
    sqlite.close()
  } catch {
    // Closed.
  }
  process.exit(0)
}

process.stdout.write("held\n")
const lines = readline.createInterface({ input: process.stdin })
lines.on("line", (line) => {
  if (line.trim() === "release") release()
})
lines.on("close", release)
