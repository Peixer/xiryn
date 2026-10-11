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
  // First, so a second process opening the database waits for the lock
  // instead of failing
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

// Opens the database (and applies migrations) the first time it's used, not
// when this module is imported: `next build` imports every route in parallel
// workers and must not touch the database at all
export function connect() {
  return (globalForDb.__oryn ??= open())
}

function lazy<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_, property) {
      const target = get()
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

export type DB = ReturnType<typeof open>["db"]
export const db: DB = lazy(() => connect().db)
export const sqlite = lazy(() => connect().sqlite)
