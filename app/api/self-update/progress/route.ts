import {
  loadSelfUpdateView,
  readDeployState,
  deployDir,
  type GithubUpdatePayload,
} from "@/lib/self-update/status"
import { submitSelfUpdate } from "@/lib/self-update/submit"
import { getUpdateInfo, latestUpdateInfo, updateChecksEnabled } from "@/lib/updates"

export const dynamic = "force-dynamic"

let lastAutoCheck = 0
const AUTO_CHECK_THROTTLE_MS = 5 * 60 * 1000

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
      try {
        const now = Date.now()
        if (now - lastAutoCheck >= AUTO_CHECK_THROTTLE_MS) {
          const view = loadSelfUpdateView()
          if (view.configured) {
            // Update throttle early to shrink race window with concurrent SSE connections
            lastAutoCheck = now
            const state = readDeployState()
            if (state.phase !== "building" && state.phase !== "switching") {
              submitSelfUpdate({
                deployDir: deployDir(),
                state,
                op: "status",
                actor: "owner",
                tip: null,
                approval: null,
                approvalId: null,
                now,
              })
            }
          }
        }
      } catch {
        // Never let auto-check break the SSE stream
      }
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
