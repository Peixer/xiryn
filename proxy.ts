import { NextResponse, type NextRequest } from "next/server"

// Oryn has no accounts: anyone who can reach the server can drive your
// agents. So it only answers on loopback, and refuses requests whose Host or
// Origin point anywhere else (which also defeats DNS-rebinding attacks from
// web pages you visit). Add hostnames to ORYN_ALLOWED_HOSTS — comma separated —
// if you deliberately expose it, e.g. behind your own authenticating proxy.

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"]

function allowedHosts() {
  const extra = (process.env.ORYN_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  return new Set([...LOOPBACK, ...extra])
}

function hostname(value: string) {
  // Strip the port, keeping IPv6 brackets intact
  const match = value.toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/)
  return match?.[1] ?? value.toLowerCase()
}

export function proxy(request: NextRequest) {
  const allowed = allowedHosts()
  const host = request.headers.get("host")
  if (!host || !allowed.has(hostname(host))) {
    return new NextResponse("Oryn only answers on localhost. See ORYN_ALLOWED_HOSTS.", {
      status: 403,
    })
  }

  const origin = request.headers.get("origin")
  if (origin && request.method !== "GET" && request.method !== "HEAD") {
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host
    } catch {}
    if (!originHost || !allowed.has(hostname(originHost))) {
      return new NextResponse("Cross-origin request refused.", { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
}
