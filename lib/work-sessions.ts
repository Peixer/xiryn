import type { CodingTool } from "@/lib/coding-session"
export type SessionStatus = "running" | "done" | "failed"
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
}
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
  session.output.push(chunk)
  // Bound retained logs for long-running sessions.
  while (session.output.length > 1000) session.output.shift()
  if (chunk.length > 20_000)
    session.output[session.output.length - 1] = chunk.slice(-20_000)
}
