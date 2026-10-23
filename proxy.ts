import { NextResponse, type NextRequest } from "next/server"

// Xiryn has no accounts: anyone who can reach the server can drive your
// agents. So it only answers on loopback, and refuses requests whose Host
// points anywhere else (which also defeats DNS-rebinding attacks from web
// pages you visit). GET and HEAD may omit Origin, so page loads and the SSE
// stream keep working. Every other method must send an Origin on an allowed
// host, which stops another website from posting a server action. This is not
// a login. Add hostnames to XIRYN_ALLOWED_HOSTS — comma separated — if you
// deliberately expose it behind your own authenticating proxy.

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"]

function allowedHosts() {
  const extra = (process.env.XIRYN_ALLOWED_HOSTS ?? "")
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
    return new NextResponse("Xiryn only answers on localhost. See XIRYN_ALLOWED_HOSTS.", {
      status: 403,
    })
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin")
    if (!origin) {
      return new NextResponse(
        "State-changing requests need an Origin on an allowed host.",
        { status: 403 }
      )
    }
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (!originHost || !allowed.has(hostname(originHost))) {
      return new NextResponse("Cross-origin request refused.", { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
}
