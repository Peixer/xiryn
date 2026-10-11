"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { agents, squads, threads } from "@/db/schema"
import { loadMessages, stopRun } from "@/lib/agent/runtime"

export async function createThread(owner: { agentId?: string; squadId?: string }) {
  if (owner.agentId) {
    const agent = db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, owner.agentId))
      .get()
    if (!agent) throw new Error("Agent not found")
  } else if (owner.squadId) {
    const squad = db
      .select({ id: squads.id })
      .from(squads)
      .where(eq(squads.id, owner.squadId))
      .get()
    if (!squad) throw new Error("Squad not found")
  } else {
    throw new Error("A thread belongs to an agent or a squad")
  }

  const [thread] = db
    .insert(threads)
    .values({ agentId: owner.agentId ?? null, squadId: owner.squadId ?? null })
    .returning({ id: threads.id })
    .all()
  revalidatePath("/", "layout")
  return thread.id
}

// What's saved in a thread, for a page catching up with a turn that started
// elsewhere (Telegram, an answered request)
export async function threadMessages(threadId: string) {
  return loadMessages(z.string().min(1).parse(threadId))
}

export async function renameThread(threadId: string, title: string) {
  const value = z.string().trim().min(1).max(80).parse(title)
  db.update(threads).set({ title: value }).where(eq(threads.id, threadId)).run()
  revalidatePath("/", "layout")
}

export async function deleteThread(threadId: string) {
  stopRun(threadId)
  db.delete(threads).where(eq(threads.id, threadId)).run()
  revalidatePath("/", "layout")
}

export async function stopThread(threadId: string) {
  return stopRun(threadId)
}
