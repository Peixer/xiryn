import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"

import { colourData, DEFAULT_LAYOUT, parseDeployConf } from "@/lib/self-update/layout"
import { confPath, readDeployState } from "@/lib/self-update/status"
import { isUtcTimestamp } from "@/lib/self-update/state"

export {
  assertRollbackConfirmation,
  isRollbackRequest,
  rollbackCallbackDecision,
} from "@/lib/self-update/rollback-confirm"

// Rows whose timestamps can move after a switch. A rollback restores the
// previous colour's database, so these are the writes that disappear, and
// the ids that exist only on the previous copy are the rows that come back.
const TOUCHED: { table: string; id: string; columns: string[] }[] = [
  { table: "messages", id: "id", columns: ["created_at"] },
  { table: "memories", id: "id", columns: ["created_at"] },
  { table: "turns", id: "id", columns: ["created_at"] },
  { table: "threads", id: "id", columns: ["created_at", "active_at"] },
  { table: "routines", id: "id", columns: ["created_at", "last_run_at"] },
  { table: "agents", id: "id", columns: ["created_at", "updated_at"] },
  {
    table: "vault_items",
    id: "id",
    columns: ["created_at", "updated_at", "last_used_at"],
  },
  { table: "settings", id: "key", columns: ["updated_at"] },
  { table: "action_approvals", id: "id", columns: ["created_at", "decided_at"] },
  { table: "vault_approvals", id: "id", columns: ["created_at", "decided_at"] },
]

export type DiscardImpact = {
  since: string | null
  written: number | null
  restored: number | null
}

function quote(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

function openReadonly(file: string) {
  if (!fs.existsSync(file)) return null
  try {
    return new Database(file, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

function tableColumns(db: Database.Database, table: string) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${quote(table)})`).all() as {
      name: string
    }[]
    if (rows.length === 0) return null
    return new Set(rows.map((row) => row.name))
  } catch {
    return null
  }
}

function countWritten(db: Database.Database, sinceMs: number) {
  let total = 0
  let saw = false
  for (const spec of TOUCHED) {
    const columns = tableColumns(db, spec.table)
    if (!columns) continue
    const present = spec.columns.filter((column) => columns.has(column))
    if (present.length === 0) continue
    saw = true
    const where = present.map((column) => `${quote(column)} >= ?`).join(" OR ")
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${quote(spec.table)} WHERE ${where}`)
      .get(...present.map(() => sinceMs)) as { n: number }
    total += Number(row.n) || 0
  }
  return saw ? total : null
}

function idsOf(db: Database.Database, table: string, id: string) {
  const columns = tableColumns(db, table)
  if (!columns || !columns.has(id)) return null
  const rows = db.prepare(`SELECT ${quote(id)} AS id FROM ${quote(table)}`).all() as {
    id: unknown
  }[]
  return new Set(rows.map((row) => String(row.id)))
}

function countRestored(previous: Database.Database, active: Database.Database) {
  let total = 0
  let saw = false
  for (const spec of TOUCHED) {
    const before = idsOf(previous, spec.table, spec.id)
    if (!before) continue
    saw = true
    const after = idsOf(active, spec.table, spec.id)
    if (!after) {
      total += before.size
      continue
    }
    for (const id of before) if (!after.has(id)) total += 1
  }
  return saw ? total : null
}

export function assessDiscard(input: {
  since: string | null
  activePath: string | null
  previousPath: string | null
}): DiscardImpact {
  const since = isUtcTimestamp(input.since) ? input.since : null
  const sinceMs = since ? Date.parse(since) : Number.NaN
  const active = input.activePath ? openReadonly(input.activePath) : null
  const previous = input.previousPath ? openReadonly(input.previousPath) : null
  try {
    const written =
      active && Number.isFinite(sinceMs) ? countWritten(active, sinceMs) : null
    const restored = active && previous ? countRestored(previous, active) : null
    return { since, written, restored }
  } finally {
    active?.close()
    previous?.close()
  }
}

export function formatDiscardImpact(impact: DiscardImpact) {
  const when = impact.since
    ? `Data written since ${impact.since} will be discarded.`
    : "Data written since the switch will be discarded."
  const written =
    impact.written === null
      ? "The live database could not be counted."
      : impact.written === 1
        ? "1 timestamped row on the live database is not in the restored copy."
        : `${impact.written} timestamped rows on the live database are not in the restored copy.`
  const restored =
    impact.restored === null
      ? "Rows removed since the switch, including vault items, come back if they are still in the previous database."
      : impact.restored === 1
        ? "1 removed row will come back, including a vault item when that is what was removed."
        : `${impact.restored} removed rows will come back, including vault items.`
  return [
    when,
    written,
    restored,
    "A backup of the database this rollback stops serving is kept.",
    "This cannot be undone from the app.",
    "The counts are as of when this was loaded.",
  ].join("\n")
}

function deployLayout() {
  try {
    if (fs.existsSync(confPath()))
      return parseDeployConf(fs.readFileSync(confPath(), "utf8"))
  } catch {
    // A missing or unreadable conf still leaves the default paths to try.
  }
  return DEFAULT_LAYOUT
}

export function loadDiscardImpact(): DiscardImpact {
  try {
    const state = readDeployState()
    const layout = deployLayout()
    const previous = state.previous
    return assessDiscard({
      since: state.switchedAt,
      activePath: path.join(colourData(layout, state.active), "xiryn.db"),
      previousPath: previous ? path.join(colourData(layout, previous), "xiryn.db") : null,
    })
  } catch {
    return { since: null, written: null, restored: null }
  }
}
