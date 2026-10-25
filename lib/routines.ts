import { and, eq, lte } from "drizzle-orm"
import { nanoid } from "nanoid"

import { db } from "@/db"
import { routines, threads, type Routine } from "@/db/schema"
import { startTurn, subscribe, TurnError } from "@/lib/agent/runtime"
import type { XirynMessage } from "@/lib/agent/tools"
import { routineRunPrompt } from "@/lib/hooks"
import { nextRun } from "@/lib/schedule"
import { backgroundWorkAllowed } from "@/lib/self-update/duty-gate"

// Runs routines when they're due. Xiryn has to be running for that: a run
// missed by a few hours (the computer was asleep) still happens when it's
// back; older ones are skipped until the next time.

const TICK = 30_000
const CATCH_UP = 6 * 3_600_000
const RETRY_BUSY = 5 * 60_000

const globalForRoutines = globalThis as unknown as {
  __xirynRoutines?: {
    timer: ReturnType<typeof setInterval> | null
    running: Set<string>
    epoch: number
  }
}
const state = (globalForRoutines.__xirynRoutines ??= {
  timer: null,
  running: new Set(),
  epoch: 0,
})

function update(id: string, values: Partial<Routine>) {
  db.update(routines).set(values).where(eq(routines.id, id)).run()
}

// The routine's own thread, made again if it was deleted
function threadFor(routine: Routine) {
  if (
    routine.threadId &&
    db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.id, routine.threadId))
      .get()
  ) {
    return routine.threadId
  }
  const [thread] = db
    .insert(threads)
    .values({ agentId: routine.agentId, squadId: routine.squadId, title: routine.name })
    .returning({ id: threads.id })
    .all()
  update(routine.id, { threadId: thread.id })
  return thread.id
}

export function threadHref(routine: Pick<Routine, "agentId" | "squadId" | "threadId">) {
  if (!routine.threadId) return null
  return routine.squadId
    ? `/s/${routine.squadId}/${routine.threadId}`
    : `/a/${routine.agentId}/${routine.threadId}`
}

// Starts a run and returns its thread once the agent is on it; the run
// itself carries on in the background. `payload` is raw webhook data; it is
// appended as untrusted text and does not move the schedule (pass manual).
export async function runRoutine(
  routine: Routine,
  { manual = false, payload }: { manual?: boolean; payload?: string } = {}
) {
  if (state.running.has(routine.id)) {
    throw new TurnError("This routine is already running.", 409)
  }
  const now = new Date()
  // Scheduled runs move on first, so a slow or failed run never repeats; a
  // one-off routine switches itself off
  if (!manual) {
    if (!routine.schedule) {
      update(routine.id, { enabled: false, nextRunAt: null })
      return null
    }
    const next = nextRun(routine.schedule, now)
    update(routine.id, { nextRunAt: next, ...(!next && { enabled: false }) })
  }

  const threadId = threadFor(routine)
  const message = {
    id: nanoid(),
    role: "user",
    parts: [{ type: "text", text: routineRunPrompt(routine.prompt, payload) }],
  } as XirynMessage

  let run
  try {
    run = await startTurn({
      threadId,
      message,
      routine: { id: routine.id, name: routine.name },
    })
  } catch (error) {
    if (!manual && error instanceof TurnError && error.status === 409) {
      // Someone's talking to the agent in this thread: try again shortly
      update(routine.id, {
        nextRunAt: new Date(Date.now() + RETRY_BUSY),
        lastStatus: "skipped",
        lastError: "The agent was busy in this thread; trying again in 5 minutes.",
      })
      return null
    }
    update(routine.id, {
      lastRunAt: now,
      lastStatus: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  update(routine.id, { lastRunAt: now, lastStatus: "running", lastError: null })
  state.running.add(routine.id)
  // Follow the run to its end to record how it went
  void (async () => {
    let failure: string | null = null
    try {
      const reader = subscribe(run).getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === "error") failure = value.errorText
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    } finally {
      state.running.delete(routine.id)
      update(routine.id, { lastStatus: failure ? "failed" : "ok", lastError: failure })
    }
  })()
  return { threadId }
}

export function isRoutineRunning(id: string) {
  return state.running.has(id)
}

export function routinesBusy() {
  return state.running.size > 0
}

async function tick() {
  const now = new Date()
  const due = db
    .select()
    .from(routines)
    .where(and(eq(routines.enabled, true), lte(routines.nextRunAt, now)))
    .all()
  for (const routine of due) {
    if (state.running.has(routine.id)) continue
    const late = now.getTime() - (routine.nextRunAt?.getTime() ?? now.getTime())
    if (!routine.schedule) {
      update(routine.id, {
        enabled: false,
        nextRunAt: null,
        lastStatus: "skipped",
        lastError: "This routine has no schedule.",
      })
      continue
    }
    if (late > CATCH_UP) {
      const next = nextRun(routine.schedule, now)
      update(routine.id, {
        nextRunAt: next,
        ...(!next && { enabled: false }),
        lastStatus: "skipped",
        lastError: "Xiryn wasn't running at the scheduled time.",
      })
      continue
    }
    runRoutine(routine).catch((error) =>
      console.error(`[xiryn] routine "${routine.name}" failed:`, error)
    )
  }
}

export function startRoutines() {
  if (!backgroundWorkAllowed()) return
  if (state.timer) return
  const epoch = state.epoch ?? 0
  const run = () => {
    if ((state.epoch ?? 0) !== epoch) return
    tick().catch((error) => console.error("[xiryn] routines:", error))
  }
  state.timer = setInterval(run, TICK)
  state.timer.unref?.()
  run()
}

export function stopRoutines() {
  state.epoch = (state.epoch ?? 0) + 1
  if (state.timer) clearInterval(state.timer)
  state.timer = null
}
