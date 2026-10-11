"use server"

import { and, eq, inArray, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  agents,
  squadInputSchema,
  squadMembers,
  squads,
  threads,
  type SquadInput,
} from "@/db/schema"

function validate(values: SquadInput) {
  const data = squadInputSchema.parse(values)
  const agentIds = [...new Set(data.agentIds)]
  const found = db
    .select({ id: agents.id })
    .from(agents)
    .where(inArray(agents.id, agentIds))
    .all()
  if (agentIds.length < 2 || found.length !== agentIds.length) {
    throw new Error("A squad needs at least two existing agents.")
  }
  return { name: data.name, agentIds }
}

export async function createSquad(values: SquadInput) {
  const { name, agentIds } = validate(values)
  const result = db.transaction((tx) => {
    const [squad] = tx.insert(squads).values({ name }).returning().all()
    tx.insert(squadMembers)
      .values(
        agentIds.map((agentId, position) => ({ squadId: squad.id, agentId, position }))
      )
      .run()
    const [thread] = tx
      .insert(threads)
      .values({ squadId: squad.id })
      .returning({ id: threads.id })
      .all()
    return { squad, threadId: thread.id }
  })
  revalidatePath("/", "layout")
  return result
}

export async function updateSquad(squadId: string, values: SquadInput) {
  const { name, agentIds } = validate(values)
  const squad = db.transaction((tx) => {
    const [squad] = tx
      .update(squads)
      .set({ name })
      .where(eq(squads.id, squadId))
      .returning()
      .all()
    if (!squad) throw new Error("Squad not found")
    tx.delete(squadMembers)
      .where(
        and(eq(squadMembers.squadId, squadId), notInArray(squadMembers.agentId, agentIds))
      )
      .run()
    for (const [position, agentId] of agentIds.entries()) {
      tx.insert(squadMembers)
        .values({ squadId, agentId, position })
        .onConflictDoUpdate({
          target: [squadMembers.squadId, squadMembers.agentId],
          set: { position },
        })
        .run()
    }
    return squad
  })
  revalidatePath("/", "layout")
  return squad
}

// The squad and its threads go; its agents stay
export async function deleteSquad(squadId: string) {
  const [squad] = db.delete(squads).where(eq(squads.id, squadId)).returning().all()
  if (!squad) throw new Error("Squad not found")
  revalidatePath("/", "layout")
}
