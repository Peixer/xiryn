import { loadSelfUpdateView, type GithubUpdatePayload } from "@/lib/self-update/status"
import { getUpdateInfo, latestUpdateInfo, updateChecksEnabled } from "@/lib/updates"

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

export function GET(request: Request) {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | null = null
  let tickCount = 0
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        tickCount = (tickCount + 1) % 3600
        if (tickCount === 1 || tickCount % 60 === 0) {
          void latestUpdateInfo()
        }
        try {
          const view = loadSelfUpdateView()
          const body = JSON.stringify({ ...view, githubUpdate: buildGithubUpdate() })
          controller.enqueue(encoder.encode(`data: ${body}\n\n`))
        } catch {
          controller.enqueue(encoder.encode(`data: {"configured":false}\n\n`))
        }
      }
      send()
      timer = setInterval(send, 1000)
      request.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      if (timer) clearInterval(timer)
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
