"use server"

import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { agentInputSchema, agents, threads, type AgentInput } from "@/db/schema"
import {
  DeleteAgentError,
  deleteAgentSafely,
  type DeleteAgentDeps,
} from "@/lib/agent-admin"
import { parsePortableAgent, prepareAgentImport } from "@/lib/agent-portable"
import { activeThreadIds, stopRun } from "@/lib/agent/runtime"
import { engineSnapshot } from "@/lib/docker"
import { getProviderMeta } from "@/lib/providers/catalog"
import { isProviderConfigured, resolveModelSpec } from "@/lib/providers/registry"
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

// A file from another install. Validates again here — the preview the page
// showed is not trusted — and always inserts a new agent. A taken name gets
// a " (2)" suffix. A model whose provider isn't configured is left empty so
// the agent uses the workspace default; `modelNotice` tells the person.
export async function importAgent(raw: string) {
  const parsed = parsePortableAgent(typeof raw === "string" ? raw : "")
  if (!parsed.ok) {
    return { ok: false as const, code: parsed.code, error: parsed.error }
  }
  const taken = db
    .select({ name: agents.name })
    .from(agents)
    .all()
    .map((row) => row.name)
  const prepared = prepareAgentImport(parsed.file, {
    takenNames: taken,
    providerConfigured: (id) => {
      const meta = getProviderMeta(id)
      return meta ? isProviderConfigured(meta.id) : false
    },
    defaultModel: resolveModelSpec(null),
    glyphFallback: nanoid(10),
  })
  const input = agentInputSchema.safeParse(prepared.input)
  if (!input.success) {
    return {
      ok: false as const,
      code: "invalid" as const,
      error: input.error.issues[0]?.message ?? "This agent file isn't valid.",
    }
  }
  try {
    const { agent, threadId } = await createAgent(input.data)
    return {
      ok: true as const,
      agent: { id: agent.id, name: agent.name },
      threadId,
      renamedFrom: prepared.renamedFrom,
      modelNotice: prepared.modelNotice,
    }
  } catch (error) {
    // The file is untrusted prompt text. Log the failure, not the payload.
    console.error(
      "[xiryn] couldn't import the agent:",
      error instanceof Error ? error.name : "unknown"
    )
    return {
      ok: false as const,
      code: "failed" as const,
      error: "Couldn't import the agent.",
    }
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
