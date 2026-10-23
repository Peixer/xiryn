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
 * Security constraints:
 *  - MAX_DEPTH = 1: a subturn cannot spawn further subturns
 *  - MAX_CONCURRENT = 3: limits simultaneous subturns per agent (workstation safety)
 *  - MAX_TASK_LENGTH = 4000: server-side cap regardless of how runSubturn is called
 *  - Timeout: 120 s wall-clock default, max 300 s
 *  - Error sanitization: internal stack traces are never returned to the model
 *  - Orphan cleanup: on module load, any leftover ephemeral threads are deleted
 */

import { nanoid } from "nanoid"
import { desc, eq } from "drizzle-orm"

import { db } from "@/db"
import { threads, turns } from "@/db/schema"
import type { Agent } from "@/db/schema"
import { startTurn, subscribe } from "@/lib/agent/runtime"
import type { XirynMessage } from "@/lib/agent/tools"

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_TASK_LENGTH = 4_000
export const MAX_CONCURRENT_PER_AGENT = 3
export const MAX_TIMEOUT_MS = 300_000
export const DEFAULT_TIMEOUT_MS = 120_000

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

// ─── Orphan cleanup (Vuln 1 fix) ─────────────────────────────────────────────
// On process start, remove any ephemeral threads left over from a crash.
// Runs once at module load time; safe to call multiple times.
;(function cleanupOrphanedEphemeralThreads() {
  try {
    const deleted = db.delete(threads).where(eq(threads.ephemeral, true)).run()
    if (deleted.changes > 0) {
      console.info(
        `[subturn] cleaned up ${deleted.changes} orphaned ephemeral thread(s) from a previous run`
      )
    }
  } catch {
    // Non-fatal — DB may not be ready yet on first boot before migrations
  }
})()

// ─── Depth guard (per thread id) ─────────────────────────────────────────────

const activeSubturnThreadIds = new Set<string>()

export function isSubturnThread(threadId: string) {
  return activeSubturnThreadIds.has(threadId)
}

// ─── Concurrency limiter per agent (Vuln 3 fix) ───────────────────────────────
//
// ⚠️  SINGLE-PROCESS ONLY: this Map lives in Node.js heap memory.
// If Xiryn ever runs with multiple workers (PM2 cluster, multiple containers),
// the limit is per-process, not per-agent globally. In that case replace this
// with a DB-backed semaphore (e.g. a `subturn_slots` table with a row per agent)
// or a Redis counter. Today Xiryn runs as a single Next.js process, so this is safe.

const activeCountPerAgent = new Map<string, number>()

function acquireSlot(agentId: string): boolean {
  const current = activeCountPerAgent.get(agentId) ?? 0
  if (current >= MAX_CONCURRENT_PER_AGENT) return false
  activeCountPerAgent.set(agentId, current + 1)
  return true
}

function releaseSlot(agentId: string) {
  const current = activeCountPerAgent.get(agentId) ?? 1
  const next = current - 1
  if (next <= 0) activeCountPerAgent.delete(agentId)
  else activeCountPerAgent.set(agentId, next)
}

// ─── Error sanitizer (Vuln 4 fix) ────────────────────────────────────────────
// Return a safe, non-leaking error message to the model.
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return "Subturn failed with an unknown error."
  // Strip stack traces and file paths — only return the first line of message
  const firstLine = err.message.split("\n")[0] ?? "Subturn failed."
  // Remove anything that looks like a file path
  return firstLine.replace(/\/[^\s]+/g, "[path]").slice(0, 200)
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function runSubturn(opts: {
  task: string
  agent: Agent
  parentThreadId: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<SubturnResult> {
  const {
    task,
    agent,
    parentThreadId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = opts

  // Vuln 2: server-side task length cap
  if (!task || task.trim().length === 0) {
    throw new Error("Subturn task must not be empty.")
  }
  if (task.length > MAX_TASK_LENGTH) {
    throw new Error(
      `Subturn task exceeds the maximum length of ${MAX_TASK_LENGTH} characters.`
    )
  }

  // Clamp timeout
  const clampedTimeout = Math.min(Math.max(timeoutMs, 1_000), MAX_TIMEOUT_MS)

  // Depth guard: reject if the parent thread is itself a subturn
  if (activeSubturnThreadIds.has(parentThreadId)) {
    throw new Error(
      "spawn_subagent cannot be called from inside a subturn (max depth = 1)."
    )
  }

  // Concurrency guard: limit simultaneous subturns per agent
  if (!acquireSlot(agent.id)) {
    throw new Error(
      `Agent already has ${MAX_CONCURRENT_PER_AGENT} subturns running. ` +
        "Wait for one to finish before spawning more."
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

  activeSubturnThreadIds.add(childThreadId)

  const timeoutController = new AbortController()
  const timeoutHandle = setTimeout(
    () =>
      timeoutController.abort(
        new Error(`Subturn timed out after ${clampedTimeout}ms`)
      ),
    clampedTimeout
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
    activeSubturnThreadIds.delete(childThreadId)
    releaseSlot(agent.id)
    // Clean up the ephemeral thread and all its messages (cascade)
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

      if (chunk.type === "text-delta" && "delta" in chunk) {
        text += (chunk as { type: "text-delta"; delta: string }).delta
      } else if (chunk.type === "error") {
        const raw = (chunk as { type: "error"; error?: unknown }).error
        error = sanitizeError(raw instanceof Error ? raw : new Error(String(raw ?? "unknown")))
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
