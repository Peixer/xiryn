"use server"

import { eq, notExists } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  agentInputSchema,
  agents,
  squadMembers,
  squads,
  threads,
  type AgentInput,
} from "@/db/schema"
import { stopRun } from "@/lib/agent/runtime"
import { engineSnapshot } from "@/lib/docker"
import { deleteWorkstation } from "@/lib/workstation"

function normalize(values: AgentInput) {
  const data = agentInputSchema.parse(values)
  return {
    ...data,
    instructions: data.instructions?.trim() || null,
    model: data.model?.trim() || null,
  }
}

// A new agent comes with an empty thread to talk to it in
export async function createAgent(values: AgentInput) {
  const data = normalize(values)
  const result = db.transaction((tx) => {
    const [agent] = tx.insert(agents).values(data).returning().all()
    const [thread] = tx
      .insert(threads)
      .values({ agentId: agent.id })
      .returning({ id: threads.id })
      .all()
    return { agent, threadId: thread.id }
  })
  revalidatePath("/", "layout")
  return result
}

export async function updateAgent(agentId: string, values: AgentInput) {
  const data = normalize(values)
  const [agent] = db
    .update(agents)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .returning()
    .all()
  if (!agent) throw new Error("Agent not found")
  revalidatePath("/", "layout")
  return agent
}

// Deletes the agent, its threads, its memory — and its workstation
export async function deleteAgent(agentId: string) {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) throw new Error("Agent not found")

  const owned = db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.agentId, agentId))
    .all()
  for (const thread of owned) stopRun(thread.id)

  // The machine and its files go too. With Docker stopped, the cleanup that
  // runs in the background removes them once it's back.
  if (engineSnapshot()?.state === "ready") await deleteWorkstation(agentId)
  db.delete(agents).where(eq(agents.id, agentId)).run()
  // A squad left with nobody in it has nothing to show
  db.delete(squads)
    .where(
      notExists(db.select().from(squadMembers).where(eq(squadMembers.squadId, squads.id)))
    )
    .run()
  revalidatePath("/", "layout")
}
