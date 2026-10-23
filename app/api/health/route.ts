import { buildHealth, collectSnapshot } from "@/lib/health"

// Uptime and Docker change while the process is up, so this is never cached.
export const dynamic = "force-dynamic"

export async function GET() {
  const report = buildHealth(await collectSnapshot())
  return Response.json(report.body, {
    status: report.httpStatus,
    headers: { "Cache-Control": "no-store" },
  })
}
