import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import * as schema from "./schema"

// Everything Oryn stores lives in one directory on your machine
// Resolved at runtime, never traced into the build
export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.ORYN_DATA_DIR || "data"
)
export const DB_PATH = path.join(DATA_DIR, "oryn.db")

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true })

  const sqlite = new Database(DB_PATH)
  // First, so that opening a fresh database from several processes at once
  // (the build's workers, say) waits for the lock instead of failing
  sqlite.pragma("busy_timeout = 5000")
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("synchronous = NORMAL")
  sqlite.pragma("foreign_keys = ON")

  const db = drizzle({ client: sqlite, schema, casing: "snake_case" })

  // Schema upgrades ship with the code and apply themselves on boot
  migrate(db, {
    migrationsFolder: path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "db",
      "migrations"
    ),
  })

  return { sqlite, db }
}

// One connection per process, kept across dev-server hot reloads
const globalForDb = globalThis as unknown as {
  __oryn?: ReturnType<typeof open>
}

const connection = (globalForDb.__oryn ??= open())

export const db = connection.db
export const sqlite = connection.sqlite
export type DB = typeof db
