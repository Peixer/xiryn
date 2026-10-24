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

for (const name of fs.readdirSync(fromDir)) {
  if (
    name === "backups" ||
    name.startsWith("vault") ||
    name.endsWith(".key") ||
    name === ".env"
  ) {
    continue
  }
  if (name === "xiryn.db" || name.startsWith("xiryn.db-")) continue
  const src = path.join(fromDir, name)
  if (!fs.statSync(src).isFile()) continue
  const dest = path.join(toDir, name)
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o600)
}
