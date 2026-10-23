"use server"

import { eq } from "drizzle-orm"
import { z } from "zod"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { agentInputSchema, agents, threads, type AgentInput } from "@/db/schema"
import {
  DeleteAgentError,
  deleteAgentSafely,
  type DeleteAgentDeps,
} from "@/lib/agent-admin"
import { activeThreadIds, stopRun } from "@/lib/agent/runtime"
import { engineSnapshot } from "@/lib/docker"
import { deleteWorkstation, workstationLeftovers } from "@/lib/workstation"

const deleteAgentSchema = z.object({
  agentId: z.string().min(1).max(64),
  stopRunning: z.boolean().optional(),
})

const realDeps: DeleteAgentDeps = {
  activeThreadIds,
  stopRun,
  engineReady: () => engineSnapshot()?.state === "ready",
  destroyWorkstation: async (agentId) => {
    try {
      await deleteWorkstation(agentId)
    } catch (error) {
      // The background janitor retries: it removes machines with no agent
      console.error("[xiryn] couldn't remove the workstation yet:", error)
    }
  },
  workstationRemains: async (agentId) => {
    try {
      return await workstationLeftovers(agentId)
    } catch {
      return true
    }
  },
}

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

// Deletes the agent, its threads, its memory, its routines — and its
// workstation. Refuses while the agent is mid-turn unless told to stop it.
// Failures come back as values: in a production build Next replaces the
// message of an error thrown from a server action with a generic one.
export async function deleteAgent(agentId: string, options?: { stopRunning?: boolean }) {
  // Read the flag off `options` explicitly. Spreading it would let a second
  // `agentId` field replace the one this function was called with.
  const input = deleteAgentSchema.safeParse({
    agentId,
    stopRunning: options?.stopRunning,
  })
  if (!input.success) {
    return { ok: false as const, code: "invalid" as const, error: "Invalid request." }
  }
  try {
    const result = await deleteAgentSafely(input.data.agentId, realDeps, {
      stopRunning: input.data.stopRunning,
    })
    revalidatePath("/", "layout")
    return { ok: true as const, ...result }
  } catch (error) {
    if (error instanceof DeleteAgentError) {
      return { ok: false as const, code: error.code, error: error.message }
    }
    console.error("[xiryn] couldn't delete the agent:", error)
    return {
      ok: false as const,
      code: "failed" as const,
      error: error instanceof Error ? error.message : "Couldn't delete the agent.",
    }
  }
}
