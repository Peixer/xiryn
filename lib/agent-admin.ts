import { and, count, eq, inArray, max, notExists, sql } from "drizzle-orm"

import { db } from "@/db"
import {
  agents,
  memories,
  messages,
  routines,
  squadMembers,
  squads,
  threads,
} from "@/db/schema"

// Everything that goes with an agent, and the one safe way to remove it.
// This module only touches the database; the parts that reach outside it
// (stopping runs, destroying the Docker workstation) come in as `deps`, so
// the rules can be tested without a model or Docker.

export type AgentFootprint = {
  threads: number
  messages: number
  memories: number
  routines: number
  // Squads the agent belongs to. Deleting the agent takes it out of each.
  squads: { id: string; name: string; members: number }[]
  lastActiveAt: Date | null
}

const EMPTY: AgentFootprint = {
  threads: 0,
  messages: 0,
  memories: 0,
  routines: 0,
  squads: [],
  lastActiveAt: null,
}

// What each agent (or just `ids`) owns, counted in a handful of queries
export function agentFootprints(ids?: string[]) {
  const scope = (column: Parameters<typeof inArray>[0]) =>
    ids ? inArray(column, ids) : undefined

  const result = new Map<string, AgentFootprint>()
  const of = (id: string) => {
    let footprint = result.get(id)
    if (!footprint) {
      footprint = { ...EMPTY, squads: [] }
      result.set(id, footprint)
    }
    return footprint
  }

  for (const row of db
    .select({
      agentId: threads.agentId,
      threads: count(),
      lastActiveAt: max(threads.activeAt),
    })
    .from(threads)
    .where(and(sql`${threads.agentId} is not null`, scope(threads.agentId)))
    .groupBy(threads.agentId)
    .all()) {
    const footprint = of(row.agentId!)
    footprint.threads = row.threads
    // max() on a timestamp_ms column comes back as raw milliseconds
    footprint.lastActiveAt = row.lastActiveAt ? new Date(Number(row.lastActiveAt)) : null
  }

  for (const row of db
    .select({ agentId: threads.agentId, messages: count() })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(and(sql`${threads.agentId} is not null`, scope(threads.agentId)))
    .groupBy(threads.agentId)
    .all()) {
    of(row.agentId!).messages = row.messages
  }

  for (const row of db
    .select({ agentId: memories.agentId, memories: count() })
    .from(memories)
    .where(and(sql`${memories.agentId} is not null`, scope(memories.agentId)))
    .groupBy(memories.agentId)
    .all()) {
    // Shared notes (null agent id) are not part of any agent's footprint.
    if (!row.agentId) continue
    of(row.agentId).memories = row.memories
  }

  for (const row of db
    .select({ agentId: routines.agentId, routines: count() })
    .from(routines)
    .where(and(sql`${routines.agentId} is not null`, scope(routines.agentId)))
    .groupBy(routines.agentId)
    .all()) {
    of(row.agentId!).routines = row.routines
  }

  const sizes = new Map(
    db
      .select({ squadId: squadMembers.squadId, members: count() })
      .from(squadMembers)
      .groupBy(squadMembers.squadId)
      .all()
      .map((row) => [row.squadId, row.members])
  )
  for (const row of db
    .select({ agentId: squadMembers.agentId, id: squads.id, name: squads.name })
    .from(squadMembers)
    .innerJoin(squads, eq(squadMembers.squadId, squads.id))
    .where(scope(squadMembers.agentId))
    .orderBy(squads.createdAt)
    .all()) {
    of(row.agentId).squads.push({
      id: row.id,
      name: row.name,
      members: sizes.get(row.id) ?? 0,
    })
  }

  return result
}

export function agentFootprint(agentId: string) {
  return agentFootprints([agentId]).get(agentId) ?? { ...EMPTY, squads: [] }
}

// Who should show as working, and therefore who a delete dialog must offer
// to stop: the thread's own agent or squad, plus every member of a squad
// whose thread is running. A squad turn is one shared run, so each member
// is mid-turn even though the thread row points at the squad.
export function busyIds(
  rows: { id: string; agentId: string | null; squadId: string | null }[],
  memberships: { squadId: string; agentId: string }[],
  active: Iterable<string>
) {
  const running = new Set(active)
  const membersBySquad = new Map<string, string[]>()
  for (const membership of memberships) {
    const members = membersBySquad.get(membership.squadId)
    if (members) members.push(membership.agentId)
    else membersBySquad.set(membership.squadId, [membership.agentId])
  }
  const busy = new Set<string>()
  for (const thread of rows) {
    if (!running.has(thread.id)) continue
    const owner = thread.agentId ?? thread.squadId
    if (owner) busy.add(owner)
    if (thread.squadId) {
      for (const agentId of membersBySquad.get(thread.squadId) ?? []) busy.add(agentId)
    }
  }
  return busy
}

// Threads with a turn running that the agent is part of: its own, and the
// squad threads of every squad it belongs to
export function workingThreads(agentId: string, active: Iterable<string>) {
  const running = new Set(active)
  if (running.size === 0) return []
  const squadIds = db
    .select({ id: squadMembers.squadId })
    .from(squadMembers)
    .where(eq(squadMembers.agentId, agentId))
    .all()
    .map((row) => row.id)
  const owned = db
    .select({ id: threads.id, agentId: threads.agentId, squadId: threads.squadId })
    .from(threads)
    .all()
  return owned
    .filter(
      (thread) =>
        running.has(thread.id) &&
        (thread.agentId === agentId ||
          (thread.squadId !== null && squadIds.includes(thread.squadId)))
    )
    .map((thread) => thread.id)
}

export type DeleteAgentCode = "not-found" | "busy" | "stuck"

export class DeleteAgentError extends Error {
  constructor(
    readonly code: DeleteAgentCode,
    message: string
  ) {
    super(message)
    this.name = "DeleteAgentError"
  }
}

export type DeleteAgentDeps = {
  // Threads with a run in progress
  activeThreadIds: () => string[]
  // Asks the run to stop; false when there was none
  stopRun: (threadId: string) => boolean
  // True once Docker is up and can be asked to remove containers
  engineReady: () => boolean
  // Removes the container and its home volume; never throws
  destroyWorkstation: (agentId: string) => Promise<void>
  // Whether the container or its volume is still there afterwards
  workstationRemains: (agentId: string) => Promise<boolean>
  // How long to wait for stopped runs to wind down (ms)
  settleMs?: number
}

export type DeleteAgentResult = {
  name: string
  removed: AgentFootprint
  stoppedRuns: number
  // "removed": gone. "pending": Docker was off or the removal failed, so the
  // background janitor removes it (it sweeps machines whose agent is gone).
  workstation: "removed" | "pending"
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function deleteAgentSafely(
  agentId: string,
  deps: DeleteAgentDeps,
  options: { stopRunning?: boolean } = {}
): Promise<DeleteAgentResult> {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) throw new DeleteAgentError("not-found", "Agent not found.")

  // 1. Never pull an agent out from under a running turn without being told to
  const working = workingThreads(agentId, deps.activeThreadIds())
  if (working.length > 0) {
    if (!options.stopRunning) {
      throw new DeleteAgentError(
        "busy",
        `${agent.name} is working on ${working.length === 1 ? "a task" : `${working.length} tasks`} right now. Stop ${working.length === 1 ? "it" : "them"} first, or delete and stop ${working.length === 1 ? "it" : "them"} together.`
      )
    }
    for (const threadId of working) deps.stopRun(threadId)
    // A stopped turn still saves what it had before it ends: wait for that
    // so it doesn't write into a thread that's about to disappear
    const deadline = Date.now() + (deps.settleMs ?? 8_000)
    while (
      workingThreads(agentId, deps.activeThreadIds()).length > 0 &&
      Date.now() < deadline
    ) {
      await sleep(50)
    }
    if (workingThreads(agentId, deps.activeThreadIds()).length > 0) {
      throw new DeleteAgentError(
        "stuck",
        `${agent.name} didn't stop in time. Nothing was deleted; try again in a moment.`
      )
    }
  }

  // 2. The rows, in one transaction. Threads, messages, memory, routines and
  // payment requests go with the agent through their foreign keys; ledger
  // rows (turns) keep their cost but lose the link, so spend history stays
  // right. Squads this agent belonged to that now have nobody left go too.
  // Other memberless squads are left alone: they were not in the confirmation.
  const removed = agentFootprint(agentId)
  const touchedSquads = removed.squads.map((squad) => squad.id)
  db.transaction((tx) => {
    tx.delete(agents).where(eq(agents.id, agentId)).run()
    if (touchedSquads.length === 0) return
    tx.delete(squads)
      .where(
        and(
          inArray(squads.id, touchedSquads),
          notExists(
            tx
              .select({ squadId: squadMembers.squadId })
              .from(squadMembers)
              .where(eq(squadMembers.squadId, squads.id))
          )
        )
      )
      .run()
  })

  // 3. The machine. The rows are already gone, so nothing can start it again
  let workstation: DeleteAgentResult["workstation"] = "pending"
  if (deps.engineReady()) {
    await deps.destroyWorkstation(agentId)
    workstation = (await deps.workstationRemains(agentId)) ? "pending" : "removed"
  }

  return { name: agent.name, removed, stoppedRuns: working.length, workstation }
}
