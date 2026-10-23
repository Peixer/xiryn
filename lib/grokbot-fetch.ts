import dns from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import net from "node:net"

import {
  GROKBOT_MAX_BYTES,
  findGrokbotTemplate,
  screenGrokbotDocument,
} from "@/lib/grokbot-import"

// Fetches a public Grok Bot share link. The response is untrusted data.
// Nothing from Xiryn's cookies or environment is forwarded.

export const GROKBOT_FETCH_TIMEOUT_MS = 10_000
export const GROKBOT_MAX_REDIRECTS = 3

const USER_AGENT = "Xiryn-GrokBot-Import"

export type GrokbotFetchOptions = {
  allowHosts?: readonly string[]
  resolveHost?: (hostname: string) => Promise<string[]>
  // Honoured only while Node's test runner is executing this process.
  allowLoopback?: boolean
}

type FetchFailure = {
  ok: false
  code: "fetch" | "oversize" | "type" | "invalid" | "hostile"
  error: string
}

export type GrokbotFetchResult =
  { ok: true; value: unknown; host: string; display: string } | FetchFailure

function screenFailure(result: { ok: false; code: string; error: string }): FetchFailure {
  const code =
    result.code === "hostile" || result.code === "oversize" ? result.code : "invalid"
  return { ok: false, code, error: result.error }
}

type Hop = {
  status: number
  location: string | null
  contentType: string | null
  body: string
  alternate: string | null
}

export function isBlockedAddress(address: string, allowLoopback = false): boolean {
  const ip = parseAddress(address)
  if (!ip) return true
  if (ip.kind === "v4") {
    if (allowLoopback && isLoopbackV4(ip.octets)) return false
    return isNonPublicV4(ip.octets)
  }
  if (ip.mapped) return isBlockedAddress(ip.mapped, allowLoopback)
  if (allowLoopback && ip.value === 1n) return false
  return isNonPublicV6(ip.value)
}

export async function fetchGrokbotShare(
  input: string,
  options: GrokbotFetchOptions = {}
): Promise<GrokbotFetchResult> {
  if (options.allowLoopback && !process.env.NODE_TEST_CONTEXT) {
    return {
      ok: false,
      code: "fetch",
      error: "Loopback fetches are only available in tests.",
    }
  }
  let start: URL
  try {
    start = new URL(input.trim())
  } catch {
    return { ok: false, code: "fetch", error: "That link isn't a valid URL." }
  }
  const deadline = Date.now() + GROKBOT_FETCH_TIMEOUT_MS
  const first = await fetchDocument(start, acceptBoth, options, deadline, new Set())
  if (!first.ok) return first
  const extracted = interpret(first.hop)
  if (extracted.ok) return { ...extracted, host: first.host, display: first.display }
  if (extracted.code === "hostile" || extracted.code === "oversize") return extracted

  const jsonRetry = await fetchDocument(
    start,
    "application/json",
    options,
    deadline,
    new Set()
  )
  if (jsonRetry.ok) {
    const again = interpret(jsonRetry.hop)
    if (again.ok) return { ...again, host: jsonRetry.host, display: jsonRetry.display }
    if (again.code === "hostile") return again
  }

  const suffixed = jsonSuffix(start)
  if (suffixed) {
    const extra = await fetchDocument(
      suffixed,
      "application/json",
      options,
      deadline,
      new Set()
    )
    if (extra.ok) {
      const again = interpret(extra.hop)
      if (again.ok) return { ...again, host: extra.host, display: extra.display }
      if (again.code === "hostile") return again
    }
  }

  if (first.hop.alternate) {
    let alternate: URL
    try {
      alternate = new URL(first.hop.alternate, start)
    } catch {
      alternate = start
    }
    if (alternate.href !== start.href) {
      const extra = await fetchDocument(
        alternate,
        "application/json",
        options,
        deadline,
        new Set()
      )
      if (extra.ok) {
        const again = interpret(extra.hop)
        if (again.ok) return { ...again, host: extra.host, display: extra.display }
        if (again.code === "hostile") return again
      }
    }
  }

  return {
    ok: false,
    code: extracted.code === "type" ? "type" : "invalid",
    error:
      extracted.code === "type"
        ? extracted.error
        : "The page did not contain a Grok Bot template. Paste the template JSON instead. The page extractor is a best effort and can miss a custom share page.",
  }
}

const acceptBoth = "application/json, text/html;q=0.9, text/plain;q=0.5"

async function fetchDocument(
  start: URL,
  accept: string,
  options: GrokbotFetchOptions,
  deadline: number,
  seen: Set<string>
): Promise<{ ok: true; hop: Hop; host: string; display: string } | FetchFailure> {
  let current = start
  let redirects = 0
  for (;;) {
    const policy = await checkUrl(current, options)
    if (!policy.ok) return policy
    if (seen.has(current.href)) {
      return { ok: false, code: "fetch", error: "The link redirected to itself." }
    }
    seen.add(current.href)
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return {
        ok: false,
        code: "fetch",
        error: "The link did not respond within 10 seconds.",
      }
    }
    let hop: Hop
    try {
      hop = await requestOnce(current, policy.address, accept, remaining)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message === "oversize") {
        return { ok: false, code: "oversize", error: "The response is larger than 2 MB." }
      }
      if (message === "timeout") {
        return {
          ok: false,
          code: "fetch",
          error: "The link did not respond within 10 seconds.",
        }
      }
      return { ok: false, code: "fetch", error: "Couldn't fetch that link." }
    }
    if (hop.status >= 300 && hop.status < 400) {
      if (!hop.location) {
        return {
          ok: false,
          code: "fetch",
          error: "The link redirected without a destination.",
        }
      }
      if (redirects >= GROKBOT_MAX_REDIRECTS) {
        return {
          ok: false,
          code: "fetch",
          error: "The link redirected more than 3 times.",
        }
      }
      let next: URL
      try {
        next = new URL(hop.location, current)
      } catch {
        return {
          ok: false,
          code: "fetch",
          error: "The link redirected to an invalid URL.",
        }
      }
      redirects += 1
      current = next
      continue
    }
    if (hop.status < 200 || hop.status >= 300) {
      return {
        ok: false,
        code: "fetch",
        error: `The link returned ${hop.status}.`,
      }
    }
    return {
      ok: true,
      hop,
      host: policy.host,
      display: displayOf(current),
    }
  }
}

async function checkUrl(
  url: URL,
  options: GrokbotFetchOptions
): Promise<{ ok: true; host: string; address: string } | FetchFailure> {
  if (url.username || url.password) {
    return {
      ok: false,
      code: "fetch",
      error: "The link must not include a username or password.",
    }
  }
  const host = url.hostname.replace(/\.$/, "").toLowerCase()
  if (!host || host.length > 253) {
    return { ok: false, code: "fetch", error: "That link has no hostname." }
  }
  const loopback = options.allowLoopback === true && !!process.env.NODE_TEST_CONTEXT
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    return {
      ok: false,
      code: "fetch",
      error: "Paste an https:// share link. Other schemes are not fetched.",
    }
  }
  const named = blockedHostname(host, loopback)
  if (named) return { ok: false, code: "fetch", error: named }
  if (!hostAllowed(host, options.allowHosts)) {
    return {
      ok: false,
      code: "fetch",
      error: `${host} is not on the Grok Bot import allowlist. Add it in Settings → Connectors, or clear the list to allow any public host.`,
    }
  }
  let addresses: string[]
  try {
    addresses = net.isIP(host) ? [host] : await resolve(host, options)
  } catch {
    return { ok: false, code: "fetch", error: "Couldn't resolve that host." }
  }
  if (addresses.length === 0) {
    return { ok: false, code: "fetch", error: "Couldn't resolve that host." }
  }
  if (addresses.some((address) => isBlockedAddress(address, loopback))) {
    return {
      ok: false,
      code: "fetch",
      error:
        "The link resolves to a private, local, or link-local address, so it was not fetched.",
    }
  }
  if (
    url.protocol === "http:" &&
    !addresses.every((address) => isLoopbackAddress(address))
  ) {
    return {
      ok: false,
      code: "fetch",
      error: "Paste an https:// share link. Other schemes are not fetched.",
    }
  }
  return { ok: true, host, address: addresses[0] }
}

function resolve(hostname: string, options: GrokbotFetchOptions) {
  if (options.resolveHost) return options.resolveHost(hostname)
  return dns
    .lookup(hostname, { all: true, verbatim: true })
    .then((records) => records.map((record) => record.address))
}

function requestOnce(target: URL, address: string, accept: string, timeoutMs: number) {
  const secure = target.protocol === "https:"
  const lib = secure ? https : http
  const port = target.port ? Number(target.port) : secure ? 443 : 80
  return new Promise<Hop>((resolvePromise, reject) => {
    const req = lib.request(
      {
        host: address,
        servername: target.hostname,
        port,
        method: "GET",
        path: `${target.pathname}${target.search}`,
        headers: {
          Host: target.host,
          Accept: accept,
          "User-Agent": USER_AGENT,
          "Accept-Encoding": "identity",
        },
        timeout: timeoutMs,
        rejectUnauthorized: true,
      },
      (res) => {
        const length = Number(res.headers["content-length"])
        if (Number.isFinite(length) && length > GROKBOT_MAX_BYTES) {
          res.resume()
          req.destroy()
          reject(new Error("oversize"))
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on("data", (chunk: Buffer) => {
          total += chunk.length
          if (total > GROKBOT_MAX_BYTES) {
            res.destroy()
            req.destroy()
            reject(new Error("oversize"))
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8")
          const type = headerValue(res.headers["content-type"])
          resolvePromise({
            status: res.statusCode ?? 0,
            location: headerValue(res.headers.location),
            contentType: type,
            body,
            alternate:
              type && mediaKind(type) === "html" ? alternateLink(body, target) : null,
          })
        })
        res.on("error", () => reject(new Error("network")))
      }
    )
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("timeout"))
    })
    req.on("error", () => reject(new Error("network")))
    req.end()
  })
}

function interpret(hop: Hop): FetchFailure | { ok: true; value: unknown } {
  const kind = hop.contentType ? mediaKind(hop.contentType) : null
  if (!kind) {
    return {
      ok: false,
      code: "type",
      error: "The link did not return JSON, HTML, or text.",
    }
  }
  if (kind === "json" || (kind === "text" && looksLikeJson(hop.body))) {
    let data: unknown
    try {
      data = JSON.parse(hop.body)
    } catch {
      if (kind === "json") {
        return { ok: false, code: "invalid", error: "That link did not return JSON." }
      }
    }
    if (data !== undefined) {
      const screened = screenGrokbotDocument(data)
      if (!screened.ok) return screenFailure(screened)
      if (!findGrokbotTemplate(data)) {
        return {
          ok: false,
          code: "invalid",
          error: "That JSON is not a Grok Bot template.",
        }
      }
      return { ok: true, value: data }
    }
  }
  if (kind === "html" || kind === "text") {
    return templateFromHtml(hop.body)
  }
  return {
    ok: false,
    code: "type",
    error: "The link did not return JSON, HTML, or text.",
  }
}

export function templateFromHtml(
  html: string
): FetchFailure | { ok: true; value: unknown } {
  // A full template wins over a public share card when the page has both.
  let share: unknown = null
  for (const value of htmlCandidates(html)) {
    const screened = screenGrokbotDocument(value)
    if (!screened.ok) return screenFailure(screened)
    const found = findGrokbotTemplate(value)
    if (!found) continue
    if (found.sharePage !== true) return { ok: true, value }
    if (share === null) share = value
  }
  if (share !== null) return { ok: true, value: share }
  return {
    ok: false,
    code: "invalid",
    error: "The page did not contain a Grok Bot template.",
  }
}

function htmlCandidates(html: string) {
  const found: unknown[] = []
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(scripts)) {
    const attrs = match[1] ?? ""
    const body = match[2] ?? ""
    const type = attr(attrs, "type")?.toLowerCase() ?? ""
    const id = attr(attrs, "id")?.toLowerCase() ?? ""
    if (
      type.includes("json") ||
      id === "__next_data__" ||
      body.includes("__next_f.push")
    ) {
      pushParsed(found, body)
      for (const pushed of flightPayloads(body)) found.push(pushed)
    }
  }
  for (const pushed of flightPayloads(html)) found.push(pushed)
  harvestObjects(html, found)
  return found
}

// "profile" is a pasted or embedded template. "botName" is the public card
// inside an x.ai share page. The flight text is scanned after it is unescaped.
function harvestObjects(text: string, found: unknown[]) {
  for (const marker of ['"profile"', '"botName"']) {
    if (!text.includes(marker)) continue
    let from = 0
    let tries = 0
    while (tries < 8) {
      const at = text.indexOf(marker, from)
      if (at < 0) break
      tries += 1
      const object = objectAround(text, at)
      if (object !== null) found.push(object)
      from = at + marker.length
    }
  }
}

function flightPayloads(source: string) {
  const found: unknown[] = []
  const needle = "__next_f.push("
  let from = 0
  let count = 0
  while (count < 20) {
    const at = source.indexOf(needle, from)
    if (at < 0) break
    count += 1
    const open = at + needle.length - 1
    const close = matchCloser(source, open, "(", ")")
    if (close < 0) break
    pushParsed(found, source.slice(open + 1, close))
    from = close + 1
  }
  return found
}

function pushParsed(found: unknown[], text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  try {
    const value = JSON.parse(trimmed) as unknown
    found.push(value)
    walkStrings(value, found, 0)
  } catch {
    const start = trimmed.indexOf("{")
    if (start >= 0) {
      try {
        found.push(JSON.parse(trimmed.slice(start)))
      } catch {
        // Not JSON. The brace scan covers the rest of the page.
      }
    }
  }
}

function walkStrings(value: unknown, found: unknown[], depth: number) {
  if (depth > 6) return
  if (typeof value === "string") {
    if (!value.includes("profile") && !value.includes("botName")) return
    const start = value.indexOf("{")
    if (start >= 0) {
      try {
        const parsed = JSON.parse(value.slice(start)) as unknown
        found.push(parsed)
        walkStrings(parsed, found, depth + 1)
      } catch {
        // A flight string is often a prefix plus JSON. The brace scan covers it.
      }
    }
    harvestObjects(value, found)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, found, depth + 1)
    return
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkStrings(item, found, depth + 1)
  }
}

function objectAround(text: string, at: number) {
  let start = at
  let attempts = 0
  while (attempts < 12) {
    start = text.lastIndexOf("{", start - 1)
    if (start < 0 || at - start > 400_000) return null
    attempts += 1
    const end = matchCloser(text, start, "{", "}")
    if (end < 0) continue
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown
    } catch {
      // Try an outer brace.
    }
  }
  return null
}

function matchCloser(text: string, open: number, left: string, right: string) {
  let depth = 0
  let quote: '"' | "'" | null = null
  let escape = false
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (escape) {
        escape = false
        continue
      }
      if (char === "\\") {
        escape = true
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === left) depth += 1
    else if (char === right) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function alternateLink(html: string, base: URL) {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1] ?? ""
    const rel = attr(attrs, "rel")?.toLowerCase() ?? ""
    const type = attr(attrs, "type")?.toLowerCase() ?? ""
    const href = attr(attrs, "href")
    if (!href || !rel.split(/\s+/).includes("alternate")) continue
    if (!type.includes("json")) continue
    try {
      return new URL(href, base).href
    } catch {
      return null
    }
  }
  return null
}

function attr(source: string, name: string) {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  ).exec(source)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function jsonSuffix(url: URL) {
  if (url.pathname.endsWith(".json")) return null
  if (url.pathname === "/" || url.pathname.endsWith("/")) return null
  const next = new URL(url.href)
  next.pathname = `${url.pathname}.json`
  return next
}

function mediaKind(header: string) {
  const type = header.split(";")[0]?.trim().toLowerCase() ?? ""
  if (type === "application/json" || type === "text/json" || type.endsWith("+json")) {
    return "json" as const
  }
  if (type === "text/html" || type === "application/xhtml+xml") return "html" as const
  if (type === "text/plain") return "text" as const
  return null
}

function looksLikeJson(body: string) {
  const trimmed = body.trim()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function displayOf(url: URL) {
  return `${url.protocol}//${url.host}${url.pathname}`
}

function hostAllowed(host: string, allowHosts: readonly string[] | undefined) {
  if (!allowHosts || allowHosts.length === 0) return true
  return allowHosts.some(
    (entry) => entry.trim().toLowerCase().replace(/\.$/, "") === host
  )
}

function blockedHostname(host: string, allowLoopback: boolean) {
  const loopbackName =
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".localdomain")
  if (loopbackName && allowLoopback) return null
  if (
    loopbackName ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return "That host is not a public address."
  }
  if (
    /^\d+(?:\.\d+){0,2}$/.test(host) ||
    (/^[\d.]+$/.test(host) && net.isIP(host) === 0)
  ) {
    return "That host is not a public address."
  }
  return null
}

function isLoopbackAddress(address: string) {
  const ip = parseAddress(address)
  if (!ip) return false
  if (ip.kind === "v4") return isLoopbackV4(ip.octets)
  if (ip.mapped) return isLoopbackAddress(ip.mapped)
  return ip.value === 1n
}

type ParsedIp =
  { kind: "v4"; octets: number[] } | { kind: "v6"; value: bigint; mapped: string | null }

function parseAddress(address: string): ParsedIp | null {
  const host = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
  if (net.isIP(host) === 4) {
    const octets = host.split(".").map(Number)
    if (octets.length !== 4 || octets.some((part) => part > 255)) return null
    return { kind: "v4", octets }
  }
  if (net.isIP(host) !== 6 && !host.includes(":")) return null
  const value = ipv6ToBigInt(host)
  if (value === null) return null
  const mappedPrefix = 0xffffn
  const mapped =
    value >> 32n === mappedPrefix ? v4From(Number(value & 0xffffffffn)) : null
  return { kind: "v6", value, mapped }
}

function v4From(n: number) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")
}

function isLoopbackV4(octets: number[]) {
  return octets[0] === 127
}

function isNonPublicV4(octets: number[]) {
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0) return true
  if (a >= 224) return true
  return false
}

function isNonPublicV6(value: bigint) {
  if (value === 0n || value === 1n) return true
  const first = Number(value >> 120n)
  if ((first & 0xfe) === 0xfc) return true
  if (Number(value >> 118n) === 0x3fa) return true
  if (first === 0xff) return true
  if (value >> 96n === 0x20010db8n) return true
  // NAT64 well-known prefix 64:ff9b::/96. The embedded IPv4 is what is reached.
  const nat64 = (0x64n << 80n) + (0xff9bn << 64n)
  if (value >> 32n === nat64) {
    return isBlockedAddress(v4From(Number(value & 0xffffffffn)))
  }
  return false
}

function ipv6ToBigInt(input: string) {
  let addr = input
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(addr)
  if (tail) {
    const parts = tail[2].split(".").map(Number)
    if (parts.some((part) => part > 255)) return null
    const hi = ((parts[0] << 8) | parts[1]).toString(16)
    const lo = ((parts[2] << 8) | parts[3]).toString(16)
    addr = `${tail[1]}${hi}:${lo}`
  }
  const halves = addr.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (halves.length === 2 && missing < 1 && !(missing === 0 && addr.endsWith("::"))) {
    if (missing < 0) return null
  }
  if (missing < 0) return null
  const groups = [...left, ...Array(missing).fill("0"), ...right]
  if (groups.length !== 8) return null
  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    value = (value << 16n) + BigInt(parseInt(group, 16))
  }
  return value
}
