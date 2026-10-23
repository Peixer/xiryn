"use server"

import { revalidatePath } from "next/cache"

import type { MemoryScope } from "@/db/schema"
import {
  addOwnerNote,
  clearAgentNotes,
  deleteOwnerNote,
  updateOwnerNote,
} from "@/lib/memory"
import { getMemories } from "@/queries/workspace"

export async function listMemories(agentId: string) {
  return getMemories(agentId)
}

export async function addMemory(
  agentId: string,
  content: string,
  scope: MemoryScope = "agent"
) {
  addOwnerNote(agentId, content, scope)
  revalidatePath("/", "layout")
  return getMemories(agentId)
}

export async function updateMemory(agentId: string, memoryId: string, content: string) {
  updateOwnerNote(agentId, memoryId, content)
  revalidatePath("/", "layout")
  return getMemories(agentId)
}

export async function deleteMemory(agentId: string, memoryId: string) {
  deleteOwnerNote(agentId, memoryId)
  revalidatePath("/", "layout")
  return getMemories(agentId)
}

export async function clearMemories(agentId: string) {
  clearAgentNotes(agentId)
  revalidatePath("/", "layout")
  return getMemories(agentId)
}
