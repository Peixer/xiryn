// Settings → Firecrawl "Test connection". Cloud still reads credit usage.
// A self-hosted server (or a cloud account whose credit route errors) is
// checked with one scrape of example.com instead.

export const FIRECRAWL_CLOUD_HOST = "api.firecrawl.dev"
export const SELF_HOSTED_PROBE_DETAIL = "connected (self-hosted, no credit info)"

const EXAMPLE = "https://example.com"

export type FirecrawlProbe =
  | { kind: "cloud"; remainingCredits: number | null; planCredits: number | null }
  | { kind: "self-hosted" }
  | { kind: "scrape" }

export function isFirecrawlCloudUrl(apiUrl: string) {
  try {
    return new URL(apiUrl).hostname === FIRECRAWL_CLOUD_HOST
  } catch {
    return false
  }
}

export function firecrawlProbeDetail(probe: FirecrawlProbe) {
  if (probe.kind === "self-hosted") return SELF_HOSTED_PROBE_DETAIL
  if (probe.kind === "scrape") return "Connected"
  const credits =
    probe.remainingCredits === null
      ? ""
      : ` · ${probe.remainingCredits.toLocaleString()}${
          probe.planCredits ? ` / ${probe.planCredits.toLocaleString()}` : ""
        } credits left`
  return `Connected${credits}`
}

type FetchImpl = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<Response>

export async function probeFirecrawl({
  apiUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 25_000,
}: {
  apiUrl: string
  apiKey?: string
  fetchImpl?: FetchImpl
  timeoutMs?: number
}): Promise<FirecrawlProbe> {
  const base = apiUrl.replace(/\/+$/, "")
  const cloud = isFirecrawlCloudUrl(base)

  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetchImpl(`${base}${path}`, {
      method: init.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { response, json, text }
  }

  if (cloud) {
    try {
      const { response, json } = await call("/v2/team/credit-usage", { method: "GET" })
      const data = readCredits(response, json)
      return { kind: "cloud", ...data }
    } catch {
      // Credit usage is cloud-only. A working scrape still means the key is good.
    }
  }

  let scrapeError: Error | null = null
  for (const path of ["/v2/scrape", "/v1/scrape"]) {
    try {
      const result = await call(path, {
        body: { url: EXAMPLE, formats: ["markdown"] },
      })
      if (!scrapeSucceeded(result.response, result.json, result.text)) {
        throw new Error(errorMessage(result.response, result.json, result.text))
      }
      return cloud ? { kind: "scrape" } : { kind: "self-hosted" }
    } catch (error) {
      scrapeError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw scrapeError ?? new Error("Firecrawl did not answer.")
}

function readCredits(response: Response, json: unknown) {
  const body = asRecord(json)
  if (!response.ok || body?.success === false) {
    throw new Error(errorMessage(response, json, ""))
  }
  const data = asRecord(body?.data) ?? body
  const remaining = numberOrNull(data?.remainingCredits)
  const plan = numberOrNull(data?.planCredits)
  if (body?.success !== true && remaining === null && plan === null) {
    throw new Error(errorMessage(response, json, ""))
  }
  return { remainingCredits: remaining, planCredits: plan }
}

function scrapeSucceeded(response: Response, json: unknown, text: string) {
  if (!response.ok) return false
  const body = asRecord(json)
  if (!body) return /example domain/i.test(text)
  if (body.success === false) return false
  if (body.success === true) return true
  const data = asRecord(body.data)
  return typeof data?.markdown === "string" || typeof body.markdown === "string"
}

function errorMessage(response: Response, json: unknown, text: string) {
  const body = asRecord(json)
  const error = body?.error
  if (typeof error === "string" && error.trim()) return error
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180)
  return snippet || `Firecrawl answered ${response.status} ${response.statusText}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
