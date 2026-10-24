import { NextResponse, type NextRequest } from "next/server"

import { maintenanceActive } from "@/lib/self-update/maintenance"

// Xiryn has no accounts: anyone who can reach the server can drive your
// agents. So it only answers on loopback, and refuses requests whose Host
// points anywhere else (which also defeats DNS-rebinding attacks from web
// pages you visit). GET and HEAD may omit Origin, so page loads and the SSE
// stream keep working. Every other method must send an Origin for this same
// host and port. Another loopback name, another port, or a decimal IP that
// parses as 127.0.0.1 does not count. This is not a login. Add hostnames to
// XIRYN_ALLOWED_HOSTS — comma separated — if you deliberately expose it
// behind your own authenticating proxy.

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

// Raw host, not URL-parser normalization. `http://2130706433` is 127.0.0.1
// to `new URL`, and that would let another local port through.
function splitAuthority(value: string): { name: string; port: string } | null {
  const lower = value.trim().toLowerCase()
  if (!lower) return null
  if (lower === "::1") return { name: "::1", port: "" }
  const match = lower.match(/^(\[[0-9a-f:.]+\]|[^[\]:@\\/]+)(?::(\d+))?$/)
  if (!match?.[1]) return null
  const name = match[1].startsWith("[") ? match[1].slice(1, -1) : match[1]
  if (!name) return null
  return { name, port: match[2] ?? "" }
}

function portsCompatible(hostPort: string, originPort: string, https: boolean) {
  if (hostPort && originPort) return hostPort === originPort
  if (hostPort && !originPort) return hostPort === (https ? "443" : "80")
  if (!hostPort && !originPort) return true
  return originPort === (https ? "443" : "80")
}

export function originMatchesHost(hostHeader: string, originHeader: string) {
  const match = originHeader.trim().match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)$/i)
  if (!match) return false
  const scheme = match[1].toLowerCase()
  if (scheme !== "http" && scheme !== "https") return false
  const origin = splitAuthority(match[2])
  const host = splitAuthority(hostHeader)
  if (!origin || !host || origin.name !== host.name) return false
  return portsCompatible(host.port, origin.port, scheme === "https")
}

export function proxy(request: NextRequest) {
  const allowed = allowedHosts()
  const host = request.headers.get("host")
  if (!host || !allowed.has(hostname(host))) {
    return new NextResponse("Xiryn only answers on localhost. See XIRYN_ALLOWED_HOSTS.", {
      status: 403,
    })
  }

  // Routine webhooks are scripts and GitHub, not a browser. They send no
  // Origin. The bearer token on the route is the credential. A present
  // Origin still has to match, and Host is checked above.
  const origin = request.headers.get("origin")
  const routineHook = request.nextUrl.pathname.startsWith("/api/hooks/")
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    !(routineHook && !origin)
  ) {
    if (!origin || !originMatchesHost(host, origin)) {
      return new NextResponse(
        origin
          ? "Cross-origin request refused."
          : "State-changing requests need an Origin on an allowed host.",
        { status: 403 }
      )
    }
  }

  // Host and Origin were checked above. During a colour switch the helper
  // marks the active process read-only; page loads still work.
  if (request.method !== "GET" && request.method !== "HEAD" && maintenanceActive()) {
    return new NextResponse("Xiryn is read-only while it switches version.", {
      status: 503,
    })
  }

  return NextResponse.next()
}

export const config = {
  // /manifest.webmanifest, /sw.js and the home-screen PNGs are ordinary GETs.
  // They stay on this matcher: a foreign Host is still refused, and an
  // allowed Host can install the app. Do not exempt them. The worker's cache
  // allowlist is lib/pwa/cache-policy.ts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
}
