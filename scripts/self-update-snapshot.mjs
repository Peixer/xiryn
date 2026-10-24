import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"

// Online backup of one colour's database into another directory.
// The vault key and .env are not in the data directory and are not copied.
const fromFlag = process.argv.indexOf("--from")
const toFlag = process.argv.indexOf("--to")
const fromDir = process.argv[fromFlag + 1]
const toDir = process.argv[toFlag + 1]
if (!fromDir || !toDir || fromDir.includes("..") || toDir.includes("..")) {
  console.error("snapshot needs --from and --to")
  process.exit(2)
}

fs.mkdirSync(toDir, { recursive: true, mode: 0o700 })
fs.chmodSync(toDir, 0o700)
const sourcePath = path.join(fromDir, "xiryn.db")
const targetPath = path.join(toDir, "xiryn.db")
const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
try {
  await source.backup(targetPath)
} finally {
  source.close()
}
fs.chmodSync(targetPath, 0o600)
for (const suffix of ["-wal", "-shm"]) {
  const extra = `${targetPath}${suffix}`
  if (fs.existsSync(extra)) fs.chmodSync(extra, 0o600)
}

function skipped(name, top) {
  if (
    name === "backups" ||
    name === ".env" ||
    name === "xiryn.db" ||
    name.startsWith("xiryn.db-")
  ) {
    return true
  }
  // A skill directory can be named vault-* or hold a .key file. Only the
  // data-dir root is where a vault key would sit beside the database.
  return top && (name.startsWith("vault") || name.endsWith(".key"))
}

// skills/ and any other subdirectory travel with the database. A symlink at
// the top can point at a key outside this directory, so those stay behind.
// Links inside skills/ are copied as links.
function copyTree(srcDir, destDir, top, underSkills) {
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(destDir, 0o700)
  for (const name of fs.readdirSync(srcDir)) {
    if (skipped(name, top)) continue
    const src = path.join(srcDir, name)
    const dest = path.join(destDir, name)
    const stat = fs.lstatSync(src)
    if (stat.isSymbolicLink()) {
      if (!underSkills) continue
      fs.symlinkSync(fs.readlinkSync(src), dest)
      continue
    }
    if (stat.isDirectory()) {
      copyTree(src, dest, false, underSkills || name === "skills")
      continue
    }
    if (!stat.isFile()) continue
    fs.copyFileSync(src, dest)
    fs.chmodSync(dest, 0o600)
  }
}

copyTree(fromDir, toDir, true, false)
