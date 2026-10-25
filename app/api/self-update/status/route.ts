import { loadSelfUpdateView, type GithubUpdatePayload } from "@/lib/self-update/status"
import { getUpdateInfo, updateChecksEnabled } from "@/lib/updates"

export const dynamic = "force-dynamic"

function buildGithubUpdate(): GithubUpdatePayload {
  if (!updateChecksEnabled()) return { enabled: false }
  const info = getUpdateInfo()
  if (!info) return null
  return {
    enabled: true,
    available: info.available,
    behind: info.behind,
    latestVersion: info.latestVersion,
    checkedAt: new Date().toISOString(),
  }
}

export function GET() {
  const view = loadSelfUpdateView()
  return Response.json({ ...view, githubUpdate: buildGithubUpdate() })
}
