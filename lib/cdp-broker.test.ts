import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { pageFromTargets } from "./page-origin"

const secret = "s3cr3t-value-not-a-label"
const brokerPath = path.resolve("workstation/rootfs/usr/local/bin/xiryn-cdp")

test("chromium flags and the page lookup do not open a debugging port", () => {
  const flags = fs.readFileSync("workstation/rootfs/etc/chromium.d/xiryn", "utf8")
  const workstation = fs.readFileSync("lib/workstation.ts", "utf8")
  const mask = fs.readFileSync("workstation/rootfs/usr/local/bin/xiryn-mask", "utf8")
  const broker = fs.readFileSync(brokerPath, "utf8")
  for (const source of [flags, workstation, mask, broker]) {
    assert.equal(source.includes("9222"), false)
    assert.equal(source.includes("remote-debugging-port"), false)
    assert.equal(source.includes("json/list"), false)
  }
  assert.match(broker, /remote-debugging-pipe/)
  assert.match(workstation, /xiryn-cdp/)
})

test("the debugging socket reports the focused origin and not a field value", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-cdp-"))
  const sock = path.join(dir, "cdp.sock")
  const exprLog = path.join(dir, "expr.log")
  const fake = path.join(dir, "fake.mjs")
  fs.writeFileSync(exprLog, "")
  fs.writeFileSync(
    fake,
    `import fs from "node:fs"
const pages = JSON.parse(process.env.FAKE_PAGES)
const secret = process.env.FAKE_SECRET
const exprLog = process.env.EXPR_LOG
let buf = Buffer.alloc(0)
function reply(obj) {
  fs.writeSync(4, Buffer.from(JSON.stringify(obj) + "\\0"))
}
function handle(msg) {
  if (msg.method === "Browser.getVersion") {
    reply({ id: msg.id, result: { protocolVersion: "1.3", product: "fake", revision: "0", userAgent: "fake", jsVersion: "0" } })
    return
  }
  if (msg.method === "Target.getTargets") {
    reply({
      id: msg.id,
      result: {
        targetInfos: pages.map((page) => ({
          targetId: page.id,
          type: page.type || "page",
          url: page.url,
          title: page.title,
        })),
      },
    })
    return
  }
  if (msg.method === "Target.attachToTarget") {
    reply({ id: msg.id, result: { sessionId: "s-" + msg.params.targetId } })
    return
  }
  if (msg.method === "Target.detachFromTarget") {
    reply({ id: msg.id, result: {} })
    return
  }
  if (msg.method === "Runtime.evaluate") {
    fs.appendFileSync(exprLog, msg.params.expression + "\\n---\\n")
    const targetId = String(msg.sessionId || "").slice(2)
    const target = pages.find((page) => page.id === targetId)
    const expr = msg.params.expression
    let value = secret
    if (expr.includes("document.hasFocus()")) {
      value = { focus: !!(target && target.focused), visible: !!(target && target.visible) }
    } else if (expr.includes("-webkit-text-security")) value = true
    reply({ id: msg.id, sessionId: msg.sessionId, result: { result: { type: typeof value, value } } })
    return
  }
  reply({ id: msg.id, result: {} })
}
function take() {
  const end = buf.indexOf(0)
  if (end < 0) return
  const raw = buf.subarray(0, end).toString("utf8")
  buf = buf.subarray(end + 1)
  try { handle(JSON.parse(raw)) } catch {}
  take()
}
function read() {
  const chunk = Buffer.alloc(65536)
  fs.read(3, chunk, 0, chunk.length, null, (err, n) => {
    if (err || !n) return
    buf = Buffer.concat([buf, chunk.subarray(0, n)])
    take()
    read()
  })
}
read()
`
  )

  const pages = [
    {
      id: "bank",
      url: "https://github.com/login",
      title: "Sign in to GitHub",
      focused: false,
      visible: false,
    },
    {
      id: "evil",
      url: `https://evil.example/login?password=${secret}`,
      title: "Sign in to GitHub",
      focused: true,
      visible: true,
    },
  ]
  const broker = spawn(process.execPath, [brokerPath, "serve"], {
    env: {
      ...process.env,
      XIRYN_CDP_CHROMIUM: process.execPath,
      XIRYN_CDP_NO_PIPE: "1",
      XIRYN_CDP_ARGS: fake,
      XIRYN_CDP_SOCK: sock,
      FAKE_PAGES: JSON.stringify(pages),
      FAKE_SECRET: secret,
      EXPR_LOG: exprLog,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let logs = ""
  broker.stderr.on("data", (chunk) => {
    logs += chunk.toString()
  })

  const ask = (op: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const conn = net.createConnection(sock)
      let buf = ""
      const timer = setTimeout(() => {
        conn.destroy()
        reject(new Error(`no reply for ${op}\n${logs}`))
      }, 4000)
      conn.setEncoding("utf8")
      conn.on("connect", () => conn.write(JSON.stringify(op) + "\n"))
      conn.on("data", (chunk) => {
        buf += chunk
        if (!buf.includes("\n")) return
        clearTimeout(timer)
        conn.end()
        resolve(JSON.parse(buf))
      })
      conn.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

  try {
    const started = Date.now()
    while (!fs.existsSync(sock)) {
      if (broker.exitCode != null) {
        throw new Error(`broker exited ${broker.exitCode}\n${logs}`)
      }
      if (Date.now() - started > 4000) throw new Error(`socket did not appear\n${logs}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const mode = fs.statSync(sock).mode & 0o777
    assert.equal(mode & 0o077, 0)

    const listed = await ask({ op: "pages" })
    assert.equal(JSON.stringify(listed).includes(secret), false)
    const chosen = pageFromTargets(
      listed.pages as { url: string; title?: string; focused: boolean }[]
    )
    assert.equal(chosen?.host, "evil.example")
    assert.equal(chosen?.url, "https://evil.example")

    const before = fs.readFileSync(exprLog, "utf8")
    const rejected = await ask({
      op: "evaluate",
      expression: `document.querySelector("input").value`,
    })
    assert.equal(rejected.error, "unsupported")
    assert.equal(fs.readFileSync(exprLog, "utf8"), before)
    assert.equal(JSON.stringify(rejected).includes(secret), false)

    const masked = await ask({ op: "mask" })
    assert.equal(typeof masked.masked, "number")
    assert.equal(JSON.stringify(masked).includes(secret), false)

    const expressions = fs.readFileSync(exprLog, "utf8").split("\n---\n").filter(Boolean)
    assert.ok(expressions.length >= 2)
    for (const expression of expressions) {
      assert.equal(expression.includes(secret), false)
      assert.equal(expression.includes("querySelector"), false)
      assert.ok(
        (expression.includes("document.hasFocus()") &&
          expression.includes("visibilityState")) ||
          expression.includes("-webkit-text-security")
      )
    }
  } finally {
    if (broker.exitCode == null) broker.kill("SIGTERM")
    await Promise.race([
      once(broker, "exit").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
    if (broker.exitCode == null) broker.kill("SIGKILL")
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
