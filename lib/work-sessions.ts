import type { CodingTool } from "@/lib/coding-session"

import { db } from "@/db"
import { getMaxWorkSessions } from "@/lib/config"
import type { WorkSessionRow } from "@/db/schema"
import { commitWorktreeChanges } from "@/lib/work-session-commit"
import {
  createWorkSessionService,
  type WorkSessionService,
} from "@/lib/work-session-service"
import {
  createDrizzleWorkSessionStore,
  listSessionViews,
  sessionHref,
} from "@/lib/work-session-store"

export type SessionStatus = "running" | "done" | "failed" | "cancelled"
export type WorkSession = {
  id: string
  agentId: string
  agentName: string
  task: string
  tool: CodingTool
  branch: string
  repoPath: string
  status: SessionStatus
  startedAt: Date
  finishedAt?: Date
  output: string[]
  durationMs?: number
  error?: string
  threadId?: string
  batchId?: string
  worktreePath?: string
}

const MAX_LIVE_CHARS = 100_000
declare global {
  var __xirynWorkSessions: Map<string, WorkSession> | undefined
}
export const workSessions: Map<string, WorkSession> = (globalThis.__xirynWorkSessions ??=
  new Map())
export function getSession(id: string) {
  return workSessions.get(id)
}
export function getSessions(): WorkSession[] {
  return [...workSessions.values()].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  )
}
export function getActiveSessions() {
  return getSessions().filter((s) => s.status === "running")
}
export function upsertSession(session: WorkSession) {
  workSessions.set(session.id, session)
}
export function cleanupOldSessions(maxAgeMs = 86_400_000) {
  for (const [id, s] of workSessions)
    if (
      s.status !== "running" &&
      (s.finishedAt ?? s.startedAt).getTime() < Date.now() - maxAgeMs
    )
      workSessions.delete(id)
}
export function appendSessionOutput(id: string, chunk: string) {
  const session = getSession(id)
  if (!session) return
  const piece = chunk.length > 20_000 ? chunk.slice(-20_000) : chunk
  session.output.push(piece)
  // Bound retained logs for long-running sessions.
  while (session.output.length > 1000) session.output.shift()
  while (session.output.reduce((sum, line) => sum + line.length, 0) > MAX_LIVE_CHARS) {
    session.output.shift()
  }
}

const globalForService = globalThis as unknown as {
  __xirynWorkSessionService?: WorkSessionService
}

function workSessionService() {
  return (globalForService.__xirynWorkSessionService ??= buildWorkSessionService())
}

function publishRow(row: WorkSessionRow) {
  const existing = getSession(row.id)
  upsertSession({
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName,
    task: row.task,
    tool: row.tool,
    branch: row.branch,
    repoPath: row.repoPath,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    output: existing?.output?.length ? existing.output : row.output ? [row.output] : [],
    durationMs: row.durationMs ?? undefined,
    error: row.error ?? undefined,
    threadId: row.threadId,
    batchId: row.batchId,
    worktreePath: row.worktreePath ?? undefined,
  })
}

function buildWorkSessionService() {
  const store = createDrizzleWorkSessionStore(db)
  return createWorkSessionService({
    store,
    maxConcurrent: getMaxWorkSessions,
    publish: publishRow,
    isThreadBusy: (threadId) => {
      const check = (
        globalThis as unknown as { __xirynThreadBusy?: (id: string) => boolean }
      ).__xirynThreadBusy
      return check ? check(threadId) : false
    },
    startTurn: async (wake) => {
      const { startTurn } = await import("@/lib/agent/runtime")
      await startTurn({
        threadId: wake.threadId,
        agentId: wake.agentId,
        message: wake.message,
      })
    },
    createWorktree: async (opts) => {
      const { createWorktree } = await import("@/lib/worktree")
      const { runWorkstationCommand } = await import("@/lib/workstation")
      return createWorktree({
        repoPath: opts.repoPath,
        baseBranch: opts.baseBranch,
        branchPrefix: opts.branchPrefix,
        taskId: opts.sessionId,
        sessionId: opts.sessionId,
        runGit: (args) => gitInWorkstation(opts.sessionId, args, runWorkstationCommand),
      })
    },
    runCoding: async (opts) => {
      const { runCodingSession } = await import("@/lib/coding-session")
      const { runWorkstationCommand } = await import("@/lib/workstation")
      const result = await runCodingSession({
        tool: opts.session.tool,
        task: opts.session.task,
        workdir: opts.workdir,
        model: opts.session.model ?? undefined,
        timeoutMs: opts.timeoutMs,
        onOutput: opts.onOutput,
        run: async (command, run) => {
          const processResult = await runWorkstationCommand(
            opts.session.agentId,
            [
              "bash",
              "-c",
              SESSION_SCRIPT,
              "work-session",
              opts.session.id,
              String(Math.ceil(run.timeoutMs / 1000)),
              ...command,
            ],
            {
              cwd: run.cwd,
              timeoutMs: run.timeoutMs + 30_000,
              onLine: run.onOutput,
            }
          )
          return {
            text: processResult.stdout.toString() + processResult.stderr,
            exitCode: processResult.exitCode ?? -1,
          }
        },
      })
      const timedOut = result.exitCode === 124 || /timed out/i.test(result.error ?? "")
      return {
        ok: result.ok,
        text: result.text,
        error: result.error,
        timedOut,
      }
    },
    commitChanges: async (session, cwd) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      return commitWorktreeChanges({
        cwd,
        runGit: (args) => gitText(session.agentId, args, runWorkstationCommand),
        onSkip: (filePath, reason) => {
          console.info(
            `[xiryn] work session ${session.id} skipped ${filePath}: ${reason}`
          )
        },
      })
    },
    hasCommits: async (session, cwd) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      try {
        const count = await gitText(
          session.agentId,
          ["-C", cwd, "rev-list", "--count", `${session.baseBranch}..HEAD`],
          runWorkstationCommand
        )
        return Number(count.trim()) > 0
      } catch {
        return false
      }
    },
    cleanupWorktree: async (session, options) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      if (!session.worktreePath) return
      await gitText(
        session.agentId,
        ["-C", session.repoPath, "worktree", "remove", "--force", session.worktreePath],
        runWorkstationCommand
      ).catch(() => "")
      if (!options.preserveBranch && session.branch) {
        await gitText(
          session.agentId,
          ["-C", session.repoPath, "branch", "-D", session.branch],
          runWorkstationCommand
        ).catch(() => "")
      }
    },
    kill: async (session) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      await runWorkstationCommand(
        session.agentId,
        ["bash", "-c", KILL_SCRIPT, "work-session", session.id],
        { timeoutMs: 15_000 }
      )
    },
    isProcessAlive: async (session) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      try {
        const result = await runWorkstationCommand(
          session.agentId,
          ["bash", "-c", ALIVE_SCRIPT, "work-session", session.id],
          { timeoutMs: 15_000 }
        )
        return result.stdout.toString().includes("alive")
      } catch {
        return false
      }
    },
    readExitCode: async (session) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      try {
        const result = await runWorkstationCommand(
          session.agentId,
          [
            "bash",
            "-c",
            "cat /tmp/xiryn/sessions/$1.exit 2>/dev/null || true",
            "bash",
            session.id,
          ],
          { timeoutMs: 15_000 }
        )
        const text = result.stdout.toString().trim()
        if (!text) return null
        const code = Number(text)
        return Number.isInteger(code) ? code : null
      } catch {
        return null
      }
    },
    readOutputTail: async (session) => {
      const { runWorkstationCommand } = await import("@/lib/workstation")
      try {
        const result = await runWorkstationCommand(
          session.agentId,
          [
            "bash",
            "-c",
            "tail -c 100000 /tmp/xiryn/sessions/$1.log 2>/dev/null || true",
            "bash",
            session.id,
          ],
          { timeoutMs: 15_000 }
        )
        return result.stdout.toString()
      } catch {
        return null
      }
    },
    log: (message) => console.error(`[xiryn] ${message}`),
  })
}

type GitRunner = (
  agentId: string,
  command: string[],
  options?: { cwd?: string; timeoutMs?: number }
) => Promise<{ exitCode: number | null; stdout: Buffer; stderr: string }>

async function gitText(agentId: string, args: string[], run: GitRunner) {
  const result = await run(agentId, ["git", ...args], { timeoutMs: 30_000 })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout.toString() || "git failed")
  }
  return result.stdout.toString()
}

async function gitInWorkstation(sessionId: string, args: string[], run: GitRunner) {
  const agentId = createDrizzleWorkSessionStore(db).getSession(sessionId)?.agentId
  if (!agentId) throw new Error("Work session disappeared before git could run.")
  return gitText(agentId, args, run)
}

const SESSION_SCRIPT = `set -o pipefail
id=$1
timeout_sec=$2
shift 2
dir=/tmp/xiryn/sessions
mkdir -p "$dir" /tmp/xiryn
echo $$ > "$dir/$id.pid"
touch /tmp/xiryn/active
(while sleep 20; do touch /tmp/xiryn/active; done) &
heartbeat=$!
trap 'kill "$heartbeat" 2>/dev/null || true; rm -f "$dir/$id.pid"; touch /tmp/xiryn/active' EXIT
timeout --signal=TERM --kill-after=5s "\${timeout_sec}s" "$@" 2>&1 | tee -a "$dir/$id.log"
code=\${PIPESTATUS[0]}
printf '%s\\n' "$code" > "$dir/$id.exit"
exit "$code"
`

const KILL_SCRIPT = `pidfile=/tmp/xiryn/sessions/$1.pid
if [ -f "$pidfile" ]; then
  pid=$(cat "$pidfile")
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
fi`

const ALIVE_SCRIPT = `pidfile=/tmp/xiryn/sessions/$1.pid
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then echo alive; else echo dead; fi`

export function spawnWorkSessions(input: Parameters<WorkSessionService["spawn"]>[0]) {
  return workSessionService().spawn(input)
}

export function listAgentWorkSessions(agentId: string, threadId?: string) {
  return workSessionService().list(agentId, threadId)
}

export function getAgentWorkSession(agentId: string, sessionId: string) {
  return workSessionService().get(agentId, sessionId)
}

export function cancelAgentWorkSession(agentId: string, sessionId: string) {
  return workSessionService().cancel(agentId, sessionId)
}

export function notifyTurnFinished(threadId: string) {
  workSessionService().notifyTurnFinished(threadId)
}

export async function recoverWorkSessions() {
  await workSessionService().recover()
}

export function cleanupPersistedSessions(maxAgeMs = 86_400_000) {
  cleanupOldSessions(maxAgeMs)
  createDrizzleWorkSessionStore(db).deleteFinishedBefore(new Date(Date.now() - maxAgeMs))
}

export function listPersistedSessionViews() {
  return listSessionViews(db).map(({ session, threadTitle, squadId }) => {
    const live = getSession(session.id)
    const output = live?.output.join("") || session.output
    return {
      id: session.id,
      agentId: session.agentId,
      agentName: session.agentName,
      threadId: session.threadId,
      threadTitle: threadTitle ?? null,
      threadHref: sessionHref({
        agentId: session.agentId,
        threadId: session.threadId,
        squadId: squadId ?? null,
      }),
      task: session.task.slice(0, 100),
      tool: session.tool,
      branch: session.branch,
      status: live?.status ?? session.status,
      startedAt: session.startedAt.toISOString(),
      finishedAt: (live?.finishedAt ?? session.finishedAt)?.toISOString() ?? null,
      durationMs: live?.durationMs ?? session.durationMs,
      outputLines: output ? output.split("\n").length : 0,
      error: live?.error ?? session.error,
    }
  })
}

export function readSessionOutput(id: string) {
  const live = getSession(id)
  if (live?.output.length) return live.output.join("")
  const row = createDrizzleWorkSessionStore(db).getSession(id)
  return row?.output ?? null
}
