import http from "node:http"

import { WebSocket, WebSocketServer } from "ws"

import { getDesktopEndpoint } from "@/lib/workstation"

// Forwards /desktop/<agent>/websockify to that agent's container. Listens on
// loopback only; Caddy (with basic auth) is what exposes it. Local use never
// comes here: the browser talks to the container port directly.

const DEFAULT_PORT = 6797

const globalForProxy = globalThis as unknown as { __xirynDesktopProxy?: boolean }

export function startDesktopProxy() {
  if (globalForProxy.__xirynDesktopProxy) return
  if (process.env.XIRYN_DESKTOP_PROXY === "off") return
  if (process.env.NEXT_PHASE === "phase-production-build") return
  globalForProxy.__xirynDesktopProxy = true
  const port = Number.parseInt(process.env.XIRYN_DESKTOP_PROXY_PORT ?? "", 10)
  const listen = Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT
  const sockets = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => {
      if (protocols.has("binary")) return "binary"
      return protocols.values().next().value ?? false
    },
  })

  const server = http.createServer((_request, response) => {
    response.writeHead(404)
    response.end()
  })

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const match = url.pathname.match(/^\/desktop\/([A-Za-z0-9_-]{1,64})\/websockify$/)
    if (!match) {
      socket.destroy()
      return
    }
    const agentId = match[1]
    void getDesktopEndpoint(agentId)
      .then(({ port: target }) => {
        sockets.handleUpgrade(request, socket, head, (client) => {
          const protocol = client.protocol || undefined
          const upstream = new WebSocket(`ws://127.0.0.1:${target}/websockify`, protocol)
          const closeBoth = () => {
            if (client.readyState === WebSocket.OPEN) client.close()
            if (upstream.readyState === WebSocket.OPEN) upstream.close()
          }
          upstream.on("open", () => {
            client.on("message", (data, isBinary) => {
              if (upstream.readyState === WebSocket.OPEN)
                upstream.send(data, { binary: isBinary })
            })
            upstream.on("message", (data, isBinary) => {
              if (client.readyState === WebSocket.OPEN)
                client.send(data, { binary: isBinary })
            })
          })
          upstream.on("error", closeBoth)
          client.on("error", closeBoth)
          upstream.on("close", () => client.close())
          client.on("close", () => upstream.close())
        })
      })
      .catch(() => socket.destroy())
  })

  server.on("error", (error) => {
    console.error("[xiryn] desktop proxy:", error)
  })
  server.listen(listen, "127.0.0.1", () => {
    console.log(`[xiryn] desktop proxy on 127.0.0.1:${listen}`)
  })
}
