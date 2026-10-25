import { getSession } from "@/lib/work-sessions"
export const dynamic = "force-dynamic"
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getSession((await params).id)
  if (!session) return Response.json({ error: "Not found" }, { status: 404 })
  return Response.json({
    id: session.id,
    status: session.status,
    output: session.output.join(""),
    durationMs: session.durationMs,
    error: session.error,
  })
}
