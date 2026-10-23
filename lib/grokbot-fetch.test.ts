import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { test } from "node:test"

import { GROKBOT_MAX_BYTES, parseGrokbotValue } from "./grokbot-import"
import { isBlockedAddress, fetchGrokbotShare, templateFromHtml } from "./grokbot-fetch"

const template = {
  profile: { name: "Link Bot", description: "Fetched sample." },
  memory: [{ kind: "profile", content: "A fetched fact." }],
  skills: [{ name: "Fetched skill", content: "Stay inside the sample." }],
  routines: [],
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler)
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo
      resolve({ server, port: address.port })
    })
  })
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

test("private, loopback, link-local and metadata addresses are blocked", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "255.255.255.255",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isBlockedAddress(address), true, address)
  }
  assert.equal(isBlockedAddress("127.0.0.1", true), false)
  assert.equal(isBlockedAddress("::1", true), false)
  assert.equal(isBlockedAddress("169.254.169.254", true), true)
  assert.equal(isBlockedAddress("8.8.8.8"), false)
  assert.equal(isBlockedAddress("2001:4860:4860::8888"), false)
})

test("a JSON share link is fetched without cookies or authorization", async () => {
  let cookie: string | undefined
  let authorization: string | undefined
  const { server, port } = await listen((req, res) => {
    cookie = req.headers.cookie
    authorization = req.headers.authorization
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ version: 1, template }))
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/bot`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.host, "share.test")
    assert.equal(cookie, undefined)
    assert.equal(authorization, undefined)
    assert.equal(
      (result.value as { template: typeof template }).template.profile.name,
      "Link Bot"
    )
  } finally {
    await close(server)
  }
})

test("HTML with embedded JSON is extracted", async () => {
  const html = `<!doctype html><html><head>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { template } },
    })}</script>
    </head><body>share</body></html>`
  const direct = templateFromHtml(html)
  assert.equal(direct.ok, true)

  const { server, port } = await listen((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8")
    res.end(html)
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/page`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.host, "share.test")
  } finally {
    await close(server)
  }
})

test("a redirect to a metadata address is refused", async () => {
  let hits = 0
  const { server, port } = await listen((_req, res) => {
    hits += 1
    res.statusCode = 302
    res.setHeader("location", "http://169.254.169.254/latest/meta-data")
    res.end()
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/start`, {
      allowLoopback: true,
      resolveHost: async (hostname) => {
        if (hostname === "share.test") return ["127.0.0.1"]
        return ["169.254.169.254"]
      },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.error, /private|local|link-local/i)
    assert.equal(hits, 1)
  } finally {
    await close(server)
  }
})

test("a redirect whose name resolves to a private address is refused", async () => {
  const { server, port } = await listen((_req, res) => {
    res.statusCode = 302
    res.setHeader("location", "https://metadata.evil/latest")
    res.end()
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/go`, {
      allowLoopback: true,
      resolveHost: async (hostname) => {
        if (hostname === "share.test") return ["127.0.0.1"]
        return ["10.0.0.8"]
      },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.error, /private|local|link-local/i)
  } finally {
    await close(server)
  }
})

test("an oversized response is refused", async () => {
  const { server, port } = await listen((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(`{"pad":"${"x".repeat(GROKBOT_MAX_BYTES)}"}`)
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/big`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, "oversize")
  } finally {
    await close(server)
  }
})

test("a non json html or text response is refused", async () => {
  const { server, port } = await listen((_req, res) => {
    res.setHeader("content-type", "application/octet-stream")
    res.end("not a template")
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/bin`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, "type")
  } finally {
    await close(server)
  }
})

test("loopback is refused outside the test-only flag", async () => {
  const result = await fetchGrokbotShare("http://127.0.0.1/secret", {
    resolveHost: async () => ["127.0.0.1"],
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /https|public|local|private/i)
})

test("flight data and a .json suffix are accepted", async () => {
  const inner = JSON.stringify(template)
  const html = `<script>self.__next_f.push(${JSON.stringify([1, `0:${inner}`])})</script>`
  const direct = templateFromHtml(html)
  assert.equal(direct.ok, true)

  const { server, port } = await listen((req, res) => {
    if (req.url?.startsWith("/page.json")) {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify(template))
      return
    }
    res.setHeader("content-type", "text/html")
    res.end("<html><body>No template here.</body></html>")
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/page`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal((result.value as { profile: { name: string } }).profile.name, "Link Bot")
  } finally {
    await close(server)
  }
})

test("Accept application/json is tried when the page has no template", async () => {
  const { server, port } = await listen((req, res) => {
    if (req.headers.accept === "application/json") {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ bot: template }))
      return
    }
    res.setHeader("content-type", "text/html")
    res.end("<html><body>shell</body></html>")
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/only-accept`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal((result.value as { bot: typeof template }).bot.profile.name, "Link Bot")
  } finally {
    await close(server)
  }
})

test("an x.ai share page is read from the Next.js flight payload", async () => {
  const card = {
    id: "SxqbG1NT5qEw7ggmHqQu_",
    ownerType: "USER",
    sharerName: null,
    botName: "Lingxi's Engineer Bot",
    description:
      'A hands-off engineering supervisor. Boards work, then says "watch } the PRs".',
    addHref: "grokbot://app/v1/bot-template?id=SxqbG1NT5qEw7ggmHqQu_",
    color: "#00BCA6",
    shape: "wedge",
  }
  const flight = `0:{"P":null}\n2d:["$","$L3c",null,{"state":{"mutations":[],"queries":[{"queryKey":["bot-template","SxqbG1NT5qEw7ggmHqQu_"],"state":{"data":${JSON.stringify(card)}}}]}}]`
  const html = `<!doctype html><html><body><script>self.__next_f.push(${JSON.stringify([1, flight])})</script></body></html>`
  const direct = templateFromHtml(html)
  assert.equal(direct.ok, true)

  const { server, port } = await listen((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8")
    res.end(html)
  })
  try {
    const result = await fetchGrokbotShare(`http://share.test:${port}/bot/Sxqb`, {
      allowLoopback: true,
      resolveHost: async () => ["127.0.0.1"],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const parsed = parseGrokbotValue(result.value, {
      takenNames: [],
      takenSlugs: [],
      skillRoom: 64,
    })
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.plan.agent.name, "Lingxi's Engineer Bot")
    assert.match(parsed.plan.agent.instructions, /watch \} the PRs/)
    assert.equal(parsed.plan.skills.length, 0)
    assert.match(
      parsed.plan.warnings.join("\n"),
      /share page only includes the name and description/
    )
  } finally {
    await close(server)
  }
})

test("a full template on the page is preferred over the public share card", () => {
  const card = {
    botName: "Card Bot",
    description: "Only the public card.",
    addHref: "grokbot://app/v1/bot-template?id=card",
  }
  const flight = `2d:${JSON.stringify({ state: { data: card } })}`
  const html = `<!doctype html>
    <script>self.__next_f.push(${JSON.stringify([1, flight])})</script>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { template } },
    })}</script>
    </html>`
  const direct = templateFromHtml(html)
  assert.equal(direct.ok, true)
  if (!direct.ok) return
  const parsed = parseGrokbotValue(direct.value, {
    takenNames: [],
    takenSlugs: [],
    skillRoom: 64,
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.plan.agent.name, "Link Bot")
  assert.equal(parsed.plan.skills.length, 1)
  assert.doesNotMatch(
    parsed.plan.warnings.join("\n"),
    /share page only includes the name and description/
  )
})

test("a link with a username or password is refused", async () => {
  const result = await fetchGrokbotShare("https://user:secret@bots.example/share")
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /username or password/)
})

test("an allowlist rejects other public hosts before connecting", async () => {
  const result = await fetchGrokbotShare("https://other.example/bot", {
    allowHosts: ["bots.example"],
    resolveHost: async () => {
      throw new Error("should not resolve")
    },
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /allowlist/)
})
