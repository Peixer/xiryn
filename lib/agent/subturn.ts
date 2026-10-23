/**
 * Subturn — run a self-contained task as a child thread of the current turn.
 *
 * Design (Candidate B):
 *  - Creates a real thread in the DB marked ephemeral=true (hidden from sidebar)
 *  - Calls startTurn() exactly as the web handler does — zero changes to the runtime
 *  - Drains the Run's ReadableStream via subscribe() and returns the full text
 *  - Cost and steps are read back from the turns table after the run finishes
 *  - The parent calls runSubturn() N times inside Promise.all → parallel execution
 *
 * Constraints:
 *  - maxDepth = 1: a subturn thread cannot spawn further subturns
 *  - Timeout: 120 s wall-clock default, configurable per call
 */

import { nanoid } from "nanoid"
import { desc, eq } from "drizzle-orm"

import { db } from "@/db"
import { threads, turns } from "@/db/schema"
import type { Agent } from "@/db/schema"
import { startTurn, subscribe } from "@/lib/agent/runtime"
import type { XirynMessage } from "@/lib/agent/tools"

// ─── Public types ─────────────────────────────────────────────────────────────

export type SubturnResult = {
  task: string
  text: string
  costUsd: number | null
  steps: number
  durationMs: number
  ok: boolean
  error?: string
}

// ─── Depth guard ──────────────────────────────────────────────────────────────

const activeSubturnThreads = new Set<string>()

export function isSubturnThread(threadId: string) {
  return activeSubturnThreads.has(threadId)
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function runSubturn(opts: {
  task: string
  agent: Agent
  parentThreadId: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<SubturnResult> {
  const { task, agent, parentThreadId, timeoutMs = 120_000, signal } = opts

  if (activeSubturnThreads.has(parentThreadId)) {
    throw new Error(
      "spawn_subagent cannot be called from inside a subturn (max depth = 1)."
    )
  }

  const childThreadId = nanoid(12)
  const startedAt = Date.now()

  db.insert(threads)
    .values({
      id: childThreadId,
      agentId: agent.id,
      parentThreadId,
      ephemeral: true,
      title: task.slice(0, 80),
      preview: task.slice(0, 140),
      activeAt: new Date(),
      createdAt: new Date(),
    })
    .run()

  activeSubturnThreads.add(childThreadId)

  const timeoutController = new AbortController()
  const timeoutHandle = setTimeout(
    () => timeoutController.abort(new Error(`Subturn timed out after ${timeoutMs}ms`)),
    timeoutMs
  )

  try {
    const message: XirynMessage = {
      id: nanoid(12),
      role: "user",
      parts: [{ type: "text", text: task }],
    }

    const run = await startTurn({
      threadId: childThreadId,
      message,
      agentId: agent.id,
      channel: "web",
    })

    const abortSignals: AbortSignal[] = [timeoutController.signal]
    if (signal) abortSignals.push(signal)
    const combinedSignal = AbortSignal.any(abortSignals)

    const { text, error } = await drainStream(subscribe(run), combinedSignal)

    const turnRow = db
      .select({ costMicros: turns.costMicros, steps: turns.steps })
      .from(turns)
      .where(eq(turns.threadId, childThreadId))
      .orderBy(desc(turns.createdAt))
      .get()

    const costUsd = turnRow?.costMicros != null ? turnRow.costMicros / 1_000_000 : null

    return {
      task,
      text,
      costUsd,
      steps: turnRow?.steps ?? 0,
      durationMs: Date.now() - startedAt,
      ok: !error,
      ...(error ? { error } : {}),
    }
  } finally {
    clearTimeout(timeoutHandle)
    activeSubturnThreads.delete(childThreadId)
    db.delete(threads).where(eq(threads.id, childThreadId)).run()
  }
}

// ─── Stream drain ─────────────────────────────────────────────────────────────

async function drainStream(
  stream: ReadableStream,
  signal: AbortSignal
): Promise<{ text: string; error?: string }> {
  const reader = stream.getReader()
  let text = ""
  let error: string | undefined

  const onAbort = () => reader.cancel("aborted").catch(() => {})
  signal.addEventListener("abort", onAbort, { once: true })

  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done || signal.aborted) {
        if (signal.aborted) error = "Subturn aborted"
        break
      }
      if (!chunk) continue

      // UIMessageChunk text-delta uses `delta` (not `textDelta`)
      if (chunk.type === "text-delta" && "delta" in chunk) {
        text += (chunk as { type: "text-delta"; delta: string }).delta
      } else if (chunk.type === "error") {
        error =
          typeof (chunk as { type: "error"; error?: unknown }).error === "string"
            ? String((chunk as { type: "error"; error?: unknown }).error)
            : "Subturn failed"
        break
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort)
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }

  return { text, error }
}
