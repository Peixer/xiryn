import { cleanupPersistedSessions, listPersistedSessionViews } from "@/lib/work-sessions"

// Same gate as the other workspace routes: proxy.ts only answers on loopback.
export const dynamic = "force-dynamic"

export function GET() {
  cleanupPersistedSessions()
  return Response.json({ sessions: listPersistedSessionViews() })
}
