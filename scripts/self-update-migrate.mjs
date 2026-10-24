import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

const dataFlag = process.argv.indexOf("--data")
const folderFlag = process.argv.indexOf("--migrations")
const dataDir = process.argv[dataFlag + 1]
const folder = process.argv[folderFlag + 1]
if (!dataDir || !folder || dataDir.includes("..") || folder.includes("..")) {
  console.error("migrate needs --data and --migrations")
  process.exit(2)
}

const journal = JSON.parse(
  fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")
)
const dbPath = path.join(dataDir, "xiryn.db")
const sqlite = new Database(dbPath)
sqlite.pragma("busy_timeout = 5000")
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")
const db = drizzle({ client: sqlite })
migrate(db, { migrationsFolder: folder })
const applied = sqlite.prepare("select count(*) as n from __drizzle_migrations").get()
sqlite.close()
fs.chmodSync(dbPath, 0o600)
process.stdout.write(
  `${JSON.stringify({
    journalCount: journal.entries.length,
    appliedCount: applied.n,
  })}\n`
)
