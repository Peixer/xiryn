import assert from "node:assert/strict"
import { test } from "node:test"

import {
  firecrawlProbeDetail,
  isFirecrawlCloudUrl,
  probeFirecrawl,
  SELF_HOSTED_PROBE_DETAIL,
} from "./firecrawl-probe"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

test("api.firecrawl.dev is the cloud host", () => {
  assert.equal(isFirecrawlCloudUrl("https://api.firecrawl.dev"), true)
  assert.equal(isFirecrawlCloudUrl("https://api.firecrawl.dev/"), true)
  assert.equal(isFirecrawlCloudUrl("http://127.0.0.1:3002"), false)
})

test("cloud credit usage is unchanged", async () => {
  const calls: string[] = []
  const probe = await probeFirecrawl({
    apiUrl: "https://api.firecrawl.dev",
    apiKey: "fc-test",
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      assert.equal(init?.headers?.Authorization, "Bearer fc-test")
      return jsonResponse({
        success: true,
        data: { remainingCredits: 12, planCredits: 40 },
      })
    },
  })
  assert.deepEqual(calls, ["GET https://api.firecrawl.dev/v2/team/credit-usage"])
  assert.equal(firecrawlProbeDetail(probe), "Connected · 12 / 40 credits left")
})

test("self-hosted skips credit usage and scrapes example.com", async () => {
  const calls: { url: string; body?: unknown }[] = []
  const probe = await probeFirecrawl({
    apiUrl: "http://127.0.0.1:3002",
    apiKey: "local",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
      return jsonResponse({
        success: true,
        data: { markdown: "# Example Domain" },
      })
    },
  })
  assert.deepEqual(calls, [
    {
      url: "http://127.0.0.1:3002/v2/scrape",
      body: { url: "https://example.com", formats: ["markdown"] },
    },
  ])
  assert.equal(probe.kind, "self-hosted")
  assert.equal(firecrawlProbeDetail(probe), SELF_HOSTED_PROBE_DETAIL)
})

test("self-hosted falls back to v1 scrape when v2 errors", async () => {
  const calls: string[] = []
  const probe = await probeFirecrawl({
    apiUrl: "http://127.0.0.1:3002/",
    apiKey: "local",
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.endsWith("/v2/scrape")) {
        return jsonResponse({ success: false, error: "unknown route" }, 404)
      }
      return jsonResponse({ success: true, data: { markdown: "Example Domain" } })
    },
  })
  assert.deepEqual(calls, [
    "http://127.0.0.1:3002/v2/scrape",
    "http://127.0.0.1:3002/v1/scrape",
  ])
  assert.equal(firecrawlProbeDetail(probe), SELF_HOSTED_PROBE_DETAIL)
})

test("cloud falls back to a scrape when credit usage fails", async () => {
  const calls: string[] = []
  const probe = await probeFirecrawl({
    apiUrl: "https://api.firecrawl.dev",
    apiKey: "fc-test",
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.endsWith("/credit-usage")) {
        return jsonResponse({ success: false, error: "unavailable" }, 500)
      }
      return jsonResponse({ success: true, data: { markdown: "# Example Domain" } })
    },
  })
  assert.deepEqual(calls, [
    "https://api.firecrawl.dev/v2/team/credit-usage",
    "https://api.firecrawl.dev/v2/scrape",
  ])
  assert.equal(probe.kind, "scrape")
  assert.equal(firecrawlProbeDetail(probe), "Connected")
})
