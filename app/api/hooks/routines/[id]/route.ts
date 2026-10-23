import { eq } from "drizzle-orm"

import { db } from "@/db"
import { routines } from "@/db/schema"
import { getSetting } from "@/lib/config"
import { handleRoutineHook, hookRateLimiter } from "@/lib/hooks"
import { runRoutine } from "@/lib/routines"

// Starts a routine from outside Xiryn. The token is the only credential.
// Writes the agent takes still wait for the normal approval; this route
// never approves anything itself, and it does not log the token or the body.

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const result = await handleRoutineHook({
    headers: request.headers,
    body: request.body,
    routineId: id,
    token: getSetting("hooks.token"),
    limiter: hookRateLimiter,
    loadRoutine: (routineId) =>
      db.select().from(routines).where(eq(routines.id, routineId)).get(),
    // manual: the schedule stays put, the same as Run now. A null result
    // is the busy path (409). Approvals are unchanged inside the run.
    startRoutine: (routine, payload) => runRoutine(routine, { manual: true, payload }),
  })

  const headers = new Headers()
  if (result.status === 429) headers.set("Retry-After", "60")
  return Response.json(result.body, { status: result.status, headers })
}
