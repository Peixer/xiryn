"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { memories, memoryInputSchema } from "@/db/schema"
import { getMemories } from "@/queries/workspace"

export async function listMemories(agentId: string) {
  return getMemories(agentId)
}

export async function addMemory(agentId: string, content: string) {
  const data = memoryInputSchema.parse({ content })
  db.insert(memories).values({ agentId, content: data.content }).run()
  revalidatePath("/", "layout")
  return getMemories(agentId)
}

export async function deleteMemory(agentId: string, memoryId: string) {
  db.delete(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.agentId, agentId)))
    .run()
  revalidatePath("/", "layout")
  return getMemories(agentId)
}

export async function clearMemories(agentId: string) {
  db.delete(memories).where(eq(memories.agentId, agentId)).run()
  revalidatePath("/", "layout")
  return getMemories(agentId)
}
