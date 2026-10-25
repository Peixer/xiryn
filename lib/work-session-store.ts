import { and, desc, eq, inArray, lt, ne, type SQL } from "drizzle-orm"

import type { DB } from "@/db"
import {
  threads,
  workSessionBatches,
  workSessionRows,
  type WorkSessionBatch,
  type WorkSessionRow,
} from "@/db/schema"

export type SessionStatus = WorkSessionRow["status"]
export type WakeStatus = WorkSessionBatch["wakeStatus"]

export type SessionPatch = Partial<
  Omit<WorkSessionRow, "id" | "batchId" | "agentId" | "threadId" | "startedAt">
>
export type BatchPatch = Partial<
  Omit<WorkSessionBatch, "id" | "agentId" | "threadId" | "createdAt">
>

export type WorkSessionStore = {
  insertBatch(row: typeof workSessionBatches.$inferInsert): void
  insertSession(row: typeof workSessionRows.$inferInsert): void
  updateBatch(id: string, patch: BatchPatch): void
  updateSession(id: string, patch: SessionPatch): void
  getSession(id: string): WorkSessionRow | undefined
  getBatch(id: string): WorkSessionBatch | undefined
  listSessions(filter?: {
    agentId?: string
    threadId?: string
    batchId?: string
    status?: SessionStatus
  }): WorkSessionRow[]
  countRunning(agentId: string): number
  // pending|queued → waking. False when another caller already claimed it.
  claimWake(id: string): boolean
  listOpenBatches(): WorkSessionBatch[]
  deleteFinishedBefore(cutoff: Date): void
}

function defined<T extends Record<string, unknown>>(patch: T) {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  )
}

export function createDrizzleWorkSessionStore(database: DB): WorkSessionStore {
  return {
    insertBatch(row) {
      database.insert(workSessionBatches).values(row).run()
    },
    insertSession(row) {
      database.insert(workSessionRows).values(row).run()
    },
    updateBatch(id, patch) {
      const set = defined(patch)
      if (Object.keys(set).length === 0) return
      database
        .update(workSessionBatches)
        .set(set)
        .where(eq(workSessionBatches.id, id))
        .run()
    },
    updateSession(id, patch) {
      const set = defined(patch)
      if (Object.keys(set).length === 0) return
      database.update(workSessionRows).set(set).where(eq(workSessionRows.id, id)).run()
    },
    getSession(id) {
      return database
        .select()
        .from(workSessionRows)
        .where(eq(workSessionRows.id, id))
        .get()
    },
    getBatch(id) {
      return database
        .select()
        .from(workSessionBatches)
        .where(eq(workSessionBatches.id, id))
        .get()
    },
    listSessions(filter = {}) {
      const where = sessionFilter(filter)
      const query = database.select().from(workSessionRows)
      return (where ? query.where(where) : query)
        .orderBy(desc(workSessionRows.startedAt))
        .all()
    },
    countRunning(agentId) {
      return database
        .select({ id: workSessionRows.id })
        .from(workSessionRows)
        .where(
          and(eq(workSessionRows.agentId, agentId), eq(workSessionRows.status, "running"))
        )
        .all().length
    },
    claimWake(id) {
      const result = database
        .update(workSessionBatches)
        .set({ wakeStatus: "waking" })
        .where(
          and(
            eq(workSessionBatches.id, id),
            inArray(workSessionBatches.wakeStatus, ["pending", "queued"])
          )
        )
        .run()
      return result.changes === 1
    },
    listOpenBatches() {
      return database
        .select()
        .from(workSessionBatches)
        .where(ne(workSessionBatches.wakeStatus, "woken"))
        .all()
    },
    deleteFinishedBefore(cutoff) {
      database
        .delete(workSessionBatches)
        .where(
          and(
            eq(workSessionBatches.wakeStatus, "woken"),
            lt(workSessionBatches.createdAt, cutoff)
          )
        )
        .run()
    },
  }
}

function sessionFilter(filter: {
  agentId?: string
  threadId?: string
  batchId?: string
  status?: SessionStatus
}): SQL | undefined {
  const parts = [
    filter.agentId ? eq(workSessionRows.agentId, filter.agentId) : undefined,
    filter.threadId ? eq(workSessionRows.threadId, filter.threadId) : undefined,
    filter.batchId ? eq(workSessionRows.batchId, filter.batchId) : undefined,
    filter.status ? eq(workSessionRows.status, filter.status) : undefined,
  ].filter((part): part is SQL => !!part)
  if (parts.length === 0) return undefined
  return and(...parts)
}

export function sessionHref(row: {
  agentId: string
  threadId: string
  squadId: string | null
}) {
  return row.squadId
    ? `/s/${row.squadId}/${row.threadId}`
    : `/a/${row.agentId}/${row.threadId}`
}

export function listSessionViews(database: DB) {
  return database
    .select({
      session: workSessionRows,
      threadTitle: threads.title,
      squadId: threads.squadId,
    })
    .from(workSessionRows)
    .leftJoin(threads, eq(workSessionRows.threadId, threads.id))
    .orderBy(desc(workSessionRows.startedAt))
    .all()
}
