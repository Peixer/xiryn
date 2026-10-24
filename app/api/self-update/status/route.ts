import { loadSelfUpdateView } from "@/lib/self-update/status"

export const dynamic = "force-dynamic"

export function GET() {
  return Response.json(loadSelfUpdateView())
}
