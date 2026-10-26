import { readSessionOutput } from "@/lib/work-sessions"
import { createDrizzleWorkSessionStore } from "@/lib/work-session-store"
import { redact } from "@/lib/self-update/redact"
import { db } from "@/db"

// Same gate as the other workspace routes: proxy.ts only answers on loopback.
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const output = readSessionOutput(id)
  if (output === null) return Response.json({ error: "Not found" }, { status: 404 })
  const row = createDrizzleWorkSessionStore(db).getSession(id)
  return Response.json({
    id,
    status: row?.status ?? "running",
    output: redact(output),
    durationMs: row?.durationMs ?? null,
    error: row?.error ? redact(row.error) : null,
    threadId: row?.threadId ?? null,
  })
}
