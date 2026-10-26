import { nanoid } from "nanoid"

import type { WorkSessionBatch, WorkSessionRow } from "@/db/schema"
import {
  canonicalRepoPath,
  REPO_PATH_ESCAPE,
  REPO_PATH_REJECTED,
  repoPathError,
} from "@/lib/repo-path"
import { worktreeLocation } from "@/lib/worktree-path"

import type { WorkSessionStore } from "./work-session-store"

export const MAX_TASKS_PER_CALL = 5
export const DEFAULT_MAX_CONCURRENT = 8
export const OUTPUT_TAIL_CHARS = 8_000
const PERSISTED_OUTPUT_CHARS = 100_000
const DEFAULT_TIMEOUT_MINUTES = 15

export type WorkSessionTask = {
  brief: string
  branch?: string
  tool?: "codex" | "claude-code"
  model?: string
  timeoutMinutes?: number
}

export type SpawnInput = {
  agentId: string
  agentName: string
  threadId: string
  tasks: WorkSessionTask[]
  repoPath: string
  baseBranch?: string
}

export type SpawnedSession = {
  id: string
  batchId: string
  threadId: string
  branch: string
  worktreePath: string
  task: string
  tool: "codex" | "claude-code"
  status: "running"
}

export type SpawnResult =
  | {
      ok: true
      started: true
      batchId: string
      threadId: string
      sessions: SpawnedSession[]
    }
  | { ok: false; started: false; error: string }

export type WakeMessage = {
  threadId: string
  agentId: string
  message: {
    id: string
    role: "system"
    parts: [{ type: "text"; text: string }]
    metadata: {
      workSessions: { batchId: string; origin: "tool"; sessionIds: string[] }
    }
  }
}

export type CodingRun = {
  ok: boolean
  text: string
  error?: string
  timedOut?: boolean
}

type LiveSession = {
  killed: boolean
  cleanup?: (options?: { preserveBranch?: boolean }) => Promise<void>
  kill: () => Promise<void>
}

export type WorkSessionServiceDeps = {
  store: WorkSessionStore
  now?: () => Date
  maxConcurrent?: () => number
  isThreadBusy: (threadId: string) => boolean
  startTurn: (message: WakeMessage) => Promise<unknown>
  createWorktree: (opts: {
    repoPath: string
    sessionId: string
    baseBranch: string
    branchPrefix: string
  }) => Promise<{
    path: string
    branch: string
    onOutput: (line: string) => void
    cleanup: (options?: { preserveBranch?: boolean }) => Promise<void>
  }>
  runCoding: (opts: {
    session: WorkSessionRow
    workdir: string
    onOutput: (line: string) => void
    timeoutMs: number
  }) => Promise<CodingRun>
  commitChanges: (
    session: WorkSessionRow,
    cwd: string
  ) => Promise<{ committed: boolean; skipped: { path: string; reason: string }[] }>
  hasCommits: (session: WorkSessionRow, cwd: string) => Promise<boolean>
  cleanupWorktree?: (
    session: WorkSessionRow,
    options: { preserveBranch: boolean }
  ) => Promise<void>
  kill?: (session: WorkSessionRow) => Promise<void>
  isProcessAlive?: (session: WorkSessionRow) => Promise<boolean>
  readExitCode?: (session: WorkSessionRow) => Promise<number | null>
  readOutputTail?: (session: WorkSessionRow) => Promise<string | null>
  sleep?: (ms: number) => Promise<void>
  publish?: (session: WorkSessionRow) => void
  log?: (message: string) => void
  // Real path inside the workstation. Missing means the session fails closed.
  resolveRepoPath?: (agentId: string, repoPath: string) => Promise<string>
}

const BRANCH_PREFIX = /^[a-zA-Z0-9_-]+$/

export function createWorkSessionService(deps: WorkSessionServiceDeps) {
  const now = deps.now ?? (() => new Date())
  const maxConcurrent = deps.maxConcurrent ?? (() => DEFAULT_MAX_CONCURRENT)
  const resolveRepoPath =
    deps.resolveRepoPath ??
    (async () => {
      throw new Error("Repository path was not resolved inside the workstation.")
    })
  const live = new Map<string, LiveSession>()
  const queued = new Map<string, string[]>()
  const outputBuffers = new Map<string, string>()
  const wakingNow = new Set<string>()

  function sessionsOf(batchId: string) {
    return deps.store.listSessions({ batchId })
  }

  function terminal(batchId: string) {
    const sessions = sessionsOf(batchId)
    return (
      sessions.length > 0 && sessions.every((session) => session.status !== "running")
    )
  }

  function publish(id: string) {
    const session = deps.store.getSession(id)
    if (session) deps.publish?.(session)
  }

  function rememberOutput(id: string, chunk: string) {
    const current = outputBuffers.get(id) ?? deps.store.getSession(id)?.output ?? ""
    const next = (current + chunk).slice(-PERSISTED_OUTPUT_CHARS)
    outputBuffers.set(id, next)
    deps.store.updateSession(id, { output: next })
    publish(id)
  }

  function finish(
    id: string,
    patch: { status: WorkSessionRow["status"]; error?: string | null }
  ) {
    const current = deps.store.getSession(id)
    if (!current || current.status !== "running") return false
    const finishedAt = now()
    deps.store.updateSession(id, {
      status: patch.status,
      error: patch.error ?? null,
      finishedAt,
      durationMs: finishedAt.getTime() - current.startedAt.getTime(),
      ...(outputBuffers.has(id) ? { output: outputBuffers.get(id) } : {}),
    })
    outputBuffers.delete(id)
    publish(id)
    return true
  }

  function enqueue(threadId: string, batchId: string) {
    const list = queued.get(threadId) ?? []
    if (!list.includes(batchId)) list.push(batchId)
    queued.set(threadId, list)
  }

  async function wakeBatch(batchId: string) {
    const batch = deps.store.getBatch(batchId)
    if (!batch || batch.wakeStatus === "woken" || batch.wakeStatus === "waking") return
    if (!terminal(batchId)) return
    if (!deps.store.claimWake(batchId)) return
    wakingNow.add(batchId)

    let settled = false
    try {
      if (deps.isThreadBusy(batch.threadId)) {
        deps.store.updateBatch(batchId, { wakeStatus: "queued" })
        enqueue(batch.threadId, batchId)
        settled = true
        return
      }
      const messageId = batch.wakeMessageId ?? nanoid()
      if (!batch.wakeMessageId)
        deps.store.updateBatch(batchId, { wakeMessageId: messageId })
      const sessions = sessionsOf(batchId)
      await deps.startTurn(wakeMessage(batch, sessions, messageId))
      deps.store.updateBatch(batchId, { wakeStatus: "woken", wokenAt: now() })
      settled = true
    } catch (error) {
      if (isBusy(error)) {
        deps.store.updateBatch(batchId, { wakeStatus: "queued" })
        enqueue(batch.threadId, batchId)
        settled = true
        return
      }
      deps.store.updateBatch(batchId, { wakeStatus: "pending" })
      settled = true
      deps.log?.(
        `wake failed for batch ${batchId}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      wakingNow.delete(batchId)
      if (!settled) deps.store.updateBatch(batchId, { wakeStatus: "pending" })
    }
  }

  function notifyTurnFinished(threadId: string) {
    const list = queued.get(threadId)
    if (!list?.length) return
    const [next, ...rest] = list
    if (rest.length) queued.set(threadId, rest)
    else queued.delete(threadId)
    void wakeBatch(next)
  }

  async function cleanup(session: WorkSessionRow, preserveBranch: boolean) {
    const handle = live.get(session.id)
    try {
      if (handle?.cleanup) await handle.cleanup({ preserveBranch })
      else if (session.worktreePath)
        await deps.cleanupWorktree?.(session, { preserveBranch })
    } catch (error) {
      deps.log?.(
        `worktree cleanup failed for ${session.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  function launch(session: WorkSessionRow, branchPrefix: string) {
    const handle: LiveSession = {
      killed: false,
      kill: async () => {
        handle.killed = true
        await deps.kill?.(session)
      },
    }
    live.set(session.id, handle)
    void (async () => {
      let workdir = ""
      try {
        const resolved = (await resolveRepoPath(session.agentId, session.repoPath)).trim()
        if (repoPathError(resolved)) throw new Error(REPO_PATH_ESCAPE)
        const repoPath = canonicalRepoPath(resolved)
        if (!repoPath) throw new Error(REPO_PATH_ESCAPE)
        if (repoPath !== session.repoPath) {
          deps.store.updateSession(session.id, { repoPath })
        }
        const worktree = await deps.createWorktree({
          repoPath,
          sessionId: session.id,
          baseBranch: session.baseBranch,
          branchPrefix,
        })
        handle.cleanup = worktree.cleanup
        workdir = worktree.path
        if (deps.store.getSession(session.id)?.status !== "running") return
        deps.store.updateSession(session.id, {
          branch: worktree.branch,
          worktreePath: worktree.path,
        })
        publish(session.id)
        const current = deps.store.getSession(session.id) ?? session
        const result = await deps.runCoding({
          session: current,
          workdir: worktree.path,
          timeoutMs: (current.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000,
          onOutput: (line) => {
            rememberOutput(session.id, line.endsWith("\n") ? line : `${line}\n`)
            worktree.onOutput(line)
          },
        })
        if (deps.store.getSession(session.id)?.status !== "running") return
        if (result.ok) {
          const committed = await deps.commitChanges(current, worktree.path)
          for (const item of committed.skipped) {
            rememberOutput(session.id, `skipped ${item.path}: ${item.reason}\n`)
          }
          await cleanup(deps.store.getSession(session.id) ?? current, true)
          finish(session.id, { status: "done" })
        } else {
          const preserve = await deps
            .hasCommits(current, worktree.path)
            .catch(() => false)
          await cleanup(deps.store.getSession(session.id) ?? current, preserve)
          finish(session.id, {
            status: "failed",
            error: failureText(result),
          })
        }
      } catch (error) {
        if (deps.store.getSession(session.id)?.status === "running") {
          const current = deps.store.getSession(session.id) ?? session
          const preserve = workdir
            ? await deps.hasCommits(current, workdir).catch(() => false)
            : false
          await cleanup(current, preserve)
          finish(session.id, {
            status: "failed",
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          })
        }
      } finally {
        live.delete(session.id)
        if (deps.store.getSession(session.id)?.status !== "cancelled")
          await wakeBatch(session.batchId)
      }
    })().catch((error) => {
      deps.log?.(
        `work session ${session.id} crashed: ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }

  function spawn(input: SpawnInput): SpawnResult {
    const error = validate(input)
    if (error) return { ok: false, started: false, error }
    const cap = maxConcurrent()
    const running = deps.store.countRunning(input.agentId)
    if (running + input.tasks.length > cap) {
      return {
        ok: false,
        started: false,
        error: `This agent already has ${running} coding session${running === 1 ? "" : "s"} running across its conversations (limit ${cap}). This call would start ${input.tasks.length} more. Cancel one or wait for a batch to finish.`,
      }
    }

    const startedAt = now()
    const batchId = nanoid(12)
    const baseBranch = input.baseBranch ?? "main"
    const repoPath = canonicalRepoPath(input.repoPath) ?? input.repoPath
    deps.store.insertBatch({
      id: batchId,
      agentId: input.agentId,
      threadId: input.threadId,
      wakeStatus: "pending",
      createdAt: startedAt,
    })

    const sessions: SpawnedSession[] = input.tasks.map((task) => {
      const id = nanoid(12)
      const prefix = task.branch ?? "task"
      const located = worktreeLocation(prefix, id)
      const row: WorkSessionRow = {
        id,
        batchId,
        agentId: input.agentId,
        threadId: input.threadId,
        agentName: input.agentName,
        task: task.brief,
        tool: task.tool ?? "codex",
        model: task.model ?? null,
        branch: located.branch,
        worktreePath: located.path,
        repoPath,
        baseBranch,
        status: "running",
        startedAt,
        finishedAt: null,
        output: "",
        durationMs: null,
        error: null,
        timeoutMinutes: task.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
      }
      deps.store.insertSession(row)
      publish(id)
      launch(row, prefix)
      return {
        id,
        batchId,
        threadId: input.threadId,
        branch: located.branch,
        worktreePath: located.path,
        task: task.brief,
        tool: row.tool,
        status: "running",
      }
    })

    return { ok: true, started: true, batchId, threadId: input.threadId, sessions }
  }

  function list(agentId: string, threadId?: string) {
    return deps.store.listSessions({ agentId, threadId }).map(summarize)
  }

  function get(agentId: string, sessionId: string) {
    const session = deps.store.getSession(sessionId)
    if (!session || session.agentId !== agentId) {
      return {
        ok: false as const,
        error: "No coding session with that id belongs to you.",
      }
    }
    return {
      ok: true as const,
      id: session.id,
      batchId: session.batchId,
      threadId: session.threadId,
      status: session.status,
      branch: session.branch,
      tool: session.tool,
      task: session.task,
      error: session.error,
      durationMs: session.durationMs,
      outputTail: session.output.slice(-OUTPUT_TAIL_CHARS),
    }
  }

  async function cancel(agentId: string, sessionId: string) {
    const session = deps.store.getSession(sessionId)
    if (!session || session.agentId !== agentId) {
      return {
        ok: false as const,
        error: "No coding session with that id belongs to you.",
      }
    }
    if (session.status !== "running") {
      return {
        ok: true as const,
        id: session.id,
        status: session.status,
        branch: session.branch,
        alreadyFinished: true as const,
      }
    }
    const preserve = session.worktreePath
      ? await deps.hasCommits(session, session.worktreePath).catch(() => false)
      : false
    const marked = finish(session.id, { status: "cancelled" })
    const handle = live.get(session.id)
    if (handle) {
      handle.killed = true
      await handle.kill().catch((error) => deps.log?.(String(error)))
    } else {
      await deps.kill?.(session).catch((error) => deps.log?.(String(error)))
    }
    await cleanup(deps.store.getSession(session.id) ?? session, preserve)
    if (marked) await wakeBatch(session.batchId)
    return {
      ok: true as const,
      id: session.id,
      status: "cancelled" as const,
      branch: session.branch,
      preservedBranch: preserve,
      alreadyFinished: false as const,
    }
  }

  async function watch(session: WorkSessionRow) {
    const handle: LiveSession = {
      killed: false,
      kill: async () => {
        handle.killed = true
        await deps.kill?.(session)
      },
    }
    live.set(session.id, handle)
    try {
      while (await deps.isProcessAlive?.(session)) {
        if (deps.store.getSession(session.id)?.status !== "running") return
        await (deps.sleep ?? delay)(5_000)
      }
      if (deps.store.getSession(session.id)?.status !== "running") return
      const code = (await deps.readExitCode?.(session)) ?? null
      const tail = (await deps.readOutputTail?.(session)) ?? ""
      if (tail) rememberOutput(session.id, tail)
      const current = deps.store.getSession(session.id) ?? session
      if (code === 0) {
        const preserve = current.worktreePath
          ? await deps.hasCommits(current, current.worktreePath).catch(() => true)
          : true
        await cleanup(current, preserve)
        finish(session.id, { status: "done" })
      } else if (code === null) {
        finish(session.id, { status: "failed", error: "server restarted" })
      } else {
        finish(session.id, {
          status: "failed",
          error: code === 124 ? "timed out" : `CLI exited with code ${code}`,
        })
      }
    } catch (error) {
      if (deps.store.getSession(session.id)?.status === "running") {
        finish(session.id, {
          status: "failed",
          error: "server restarted",
        })
        deps.log?.(
          `lost work session ${session.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    } finally {
      live.delete(session.id)
      if (deps.store.getSession(session.id)?.status !== "cancelled")
        await wakeBatch(session.batchId)
    }
  }

  async function recover() {
    const running = deps.store.listSessions({ status: "running" })
    for (const session of running) {
      if (live.has(session.id)) continue
      const alive = deps.isProcessAlive
        ? await deps.isProcessAlive(session).catch(() => false)
        : false
      if (alive) void watch(session)
      else finish(session.id, { status: "failed", error: "server restarted" })
    }
    for (const batch of deps.store.listOpenBatches()) {
      if (batch.wakeStatus === "waking" && !wakingNow.has(batch.id)) {
        deps.store.updateBatch(batch.id, { wakeStatus: "pending" })
      }
      await wakeBatch(batch.id)
    }
  }

  return { spawn, list, get, cancel, recover, notifyTurnFinished }
}

export type WorkSessionService = ReturnType<typeof createWorkSessionService>

function validate(input: SpawnInput) {
  if (!input.tasks.length) return "Give spawn_work_session at least one task."
  const pathError = repoPathError(input.repoPath)
  if (pathError) return pathError
  if (input.tasks.length > MAX_TASKS_PER_CALL) {
    return `spawn_work_session starts at most ${MAX_TASKS_PER_CALL} tasks per call.`
  }
  if (!canonicalRepoPath(input.repoPath)) return REPO_PATH_REJECTED
  if (input.baseBranch && !/^[a-zA-Z0-9_./-]+$/.test(input.baseBranch)) {
    return "Base branch contains characters git will not accept."
  }
  for (const task of input.tasks) {
    if (!task.brief.trim()) return "Every task needs a brief."
    if (task.brief.length > 4000) return "A task brief is longer than 4000 characters."
    if (task.branch && !BRANCH_PREFIX.test(task.branch)) {
      return "Branch prefixes may only use letters, numbers, underscores and hyphens."
    }
  }
  return null
}

function failureText(result: CodingRun) {
  if (result.timedOut) return "timed out"
  return (result.error || "coding session failed").slice(0, 500)
}

function wakeMessage(
  batch: WorkSessionBatch,
  sessions: WorkSessionRow[],
  messageId: string
): WakeMessage {
  const lines = sessions.map((session) => {
    const tail = session.output.trim().slice(-2_000)
    return [
      `- ${session.status} \`${session.branch || "(no branch)"}\` (${session.tool})`,
      `  task: ${session.task.slice(0, 400)}`,
      session.error ? `  error: ${session.error}` : null,
      session.durationMs != null ? `  durationMs: ${session.durationMs}` : null,
      tail ? `  output tail:\n${tail}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  })
  const text = [
    `[Work sessions finished. This notice was posted by the coding-session tool for batch ${batch.id}. The person did not write it. Summarise the branches, what changed, and any failures in this conversation. Do not start another session unless they ask, and do not push or open a pull request unless they ask.]`,
    "",
    lines.join("\n\n"),
  ].join("\n")
  return {
    threadId: batch.threadId,
    agentId: batch.agentId,
    message: {
      id: messageId,
      role: "system",
      parts: [{ type: "text", text }],
      metadata: {
        workSessions: {
          batchId: batch.id,
          origin: "tool",
          sessionIds: sessions.map((session) => session.id),
        },
      },
    },
  }
}

function summarize(session: WorkSessionRow) {
  return {
    id: session.id,
    batchId: session.batchId,
    threadId: session.threadId,
    branch: session.branch,
    worktreePath: session.worktreePath,
    status: session.status,
    tool: session.tool,
    task: session.task,
    error: session.error,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationMs: session.durationMs,
  }
}

function isBusy(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 409
  )
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
