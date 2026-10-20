"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  agents,
  routineInputSchema,
  routines,
  squads,
  type RoutineSchedule,
} from "@/db/schema"
import { runRoutine, threadHref } from "@/lib/routines"
import { nextRun } from "@/lib/schedule"

const idSchema = z.string().trim().min(1).max(40)

function load(id: string) {
  const routine = db
    .select()
    .from(routines)
    .where(eq(routines.id, idSchema.parse(id)))
    .get()
  if (!routine) throw new Error("This routine no longer exists.")
  return routine
}

function checkOwner(input: { agentId?: string | null; squadId?: string | null }) {
  const exists = input.agentId
    ? db.select({ id: agents.id }).from(agents).where(eq(agents.id, input.agentId)).get()
    : db
        .select({ id: squads.id })
        .from(squads)
        .where(eq(squads.id, input.squadId ?? ""))
        .get()
  if (!exists) throw new Error("That agent or squad no longer exists.")
}

function firstRun(schedule: RoutineSchedule) {
  const next = nextRun(schedule)
  if (!next) throw new Error("That time has already passed.")
  return next
}

export async function saveRoutine(input: unknown, id?: string) {
  const values = routineInputSchema.parse(input)
  checkOwner(values)
  const row = {
    name: values.name,
    agentId: values.agentId || null,
    squadId: values.squadId || null,
    prompt: values.prompt,
    schedule: values.schedule,
    enabled: values.enabled,
    nextRunAt: values.enabled ? firstRun(values.schedule) : null,
  }
  if (id) {
    const current = load(id)
    // Moving a routine to someone else starts a fresh thread
    const moved = current.agentId !== row.agentId || current.squadId !== row.squadId
    db.update(routines)
      .set({ ...row, ...(moved && { threadId: null }) })
      .where(eq(routines.id, current.id))
      .run()
  } else {
    db.insert(routines).values(row).run()
  }
  revalidatePath("/routines")
}

export async function setRoutineEnabled(id: string, enabled: boolean) {
  const routine = load(id)
  db.update(routines)
    .set({ enabled, nextRunAt: enabled ? firstRun(routine.schedule) : null })
    .where(eq(routines.id, routine.id))
    .run()
  revalidatePath("/routines")
}

export async function deleteRoutine(id: string) {
  db.delete(routines)
    .where(eq(routines.id, idSchema.parse(id)))
    .run()
  revalidatePath("/routines")
}

// Starts a run now; it carries on in the background. Returns the thread to
// watch it in.
export async function runRoutineNow(id: string) {
  const routine = load(id)
  try {
    await runRoutine(routine, { manual: true })
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  revalidatePath("/", "layout")
  const fresh = load(id)
  return { ok: true as const, href: threadHref(fresh) }
}
