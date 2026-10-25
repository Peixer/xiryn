import { cleanupOldSessions, getSessions } from "@/lib/work-sessions"
export const dynamic = "force-dynamic"
export function GET() {
  cleanupOldSessions()
  return Response.json({
    sessions: getSessions().map((s) => ({
      id: s.id,
      agentName: s.agentName,
      task: s.task.slice(0, 100),
      tool: s.tool,
      branch: s.branch,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
      finishedAt: s.finishedAt?.toISOString(),
      durationMs: s.durationMs,
      outputLines: s.output.join("").split("\n").length,
      error: s.error,
    })),
  })
}
