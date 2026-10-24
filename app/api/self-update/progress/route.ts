import { loadSelfUpdateView } from "@/lib/self-update/status"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          const body = JSON.stringify(loadSelfUpdateView())
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
