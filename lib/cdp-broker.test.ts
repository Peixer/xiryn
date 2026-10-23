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
const browserPath = path.resolve("workstation/rootfs/usr/local/bin/browser")

test("chromium flags and the page lookup do not open a debugging port", () => {
  const flags = fs.readFileSync("workstation/rootfs/etc/chromium.d/xiryn", "utf8")
  const workstation = fs.readFileSync("lib/workstation.ts", "utf8")
  const mask = fs.readFileSync("workstation/rootfs/usr/local/bin/xiryn-mask", "utf8")
  const broker = fs.readFileSync(brokerPath, "utf8")
  const browser = fs.readFileSync(browserPath, "utf8")
  for (const source of [flags, workstation, mask, broker, browser]) {
    assert.equal(source.includes("9222"), false)
    assert.equal(source.includes("remote-debugging-port"), false)
    assert.equal(source.includes("json/list"), false)
  }
  assert.match(broker, /remote-debugging-pipe/)
  assert.match(workstation, /xiryn-cdp/)
  assert.match(browser, /xiryn-cdp ping/)
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

    const ping = await ask({ op: "ping" })
    assert.deepEqual(ping, { ok: true })
    assert.equal(JSON.stringify(ping).includes(secret), false)

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

// A killed broker leaves the socket file behind. /tmp survives `docker stop`,
// which is how an idle workstation shuts down.
async function leftoverSocket(sock: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const net = require("net")
const server = net.createServer()
server.listen(process.argv[1], () => process.stdout.write("up\\n"))`,
      sock,
    ],
    { stdio: ["ignore", "pipe", "inherit"] }
  )
  let out = ""
  child.stdout?.on("data", (chunk) => {
    out += chunk.toString()
  })
  const started = Date.now()
  while (!out.includes("up")) {
    if (child.exitCode != null) throw new Error("socket helper exited")
    if (Date.now() - started > 2000) throw new Error("socket did not listen")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  child.kill("SIGKILL")
  await once(child, "exit")
  assert.equal(fs.statSync(sock).isSocket(), true)
}

function installBrowserFakes(dir: string) {
  const bin = path.join(dir, "bin")
  const callLog = path.join(dir, "calls.log")
  const ready = path.join(dir, "ready")
  const pidfile = path.join(dir, "broker.pid")
  fs.mkdirSync(bin)
  fs.writeFileSync(callLog, "")
  const cdp = `#!/bin/bash
printf '%s\\n' "call:\${1:-serve}" >> "$CALL_LOG"
if [ "\${1:-}" = "ping" ]; then
  [ -f "$READY" ] && exit 0
  exit 1
fi
echo $$ > "$PIDFILE"
exec node -e '
const net = require("net")
const fs = require("fs")
const sock = process.env.XIRYN_CDP_SOCK
const ready = process.env.READY
try { fs.unlinkSync(sock) } catch {}
const server = net.createServer((conn) => conn.end())
server.listen(sock, () => fs.writeFileSync(ready, "1"))
setInterval(() => {}, 1 << 30)
'
`
  fs.writeFileSync(path.join(bin, "xiryn-cdp"), cdp)
  fs.writeFileSync(
    path.join(bin, "chromium"),
    `#!/bin/bash\nprintf '%s\\n' "chromium:$*" >> "$CALL_LOG"\n`
  )
  fs.chmodSync(path.join(bin, "xiryn-cdp"), 0o755)
  fs.chmodSync(path.join(bin, "chromium"), 0o755)
  return { bin, callLog, ready, pidfile }
}

async function runBrowser(dir: string, sock: string, bin: string) {
  const child = spawn("bash", [browserPath], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      XIRYN_CDP_SOCK: sock,
      CALL_LOG: path.join(dir, "calls.log"),
      READY: path.join(dir, "ready"),
      PIDFILE: path.join(dir, "broker.pid"),
    },
  })
  const timer = setTimeout(() => child.kill("SIGKILL"), 8000)
  await once(child, "exit")
  clearTimeout(timer)
  assert.equal(child.exitCode, 0)
}

test("the workstation smoke test checks the broker and keeps port 9222 closed", () => {
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8")
  assert.match(ci, /xiryn-cdp pages/)
  assert.match(ci, /9222\/json\/version/)
  assert.doesNotMatch(ci, /9222\/json\/version && exit 0/)
  assert.match(ci, /--cap-drop ALL/)
  assert.match(ci, /no-new-privileges/)
})

test("browser replaces a leftover debugging socket from a stopped machine", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-browser-"))
  const sock = path.join(dir, "cdp.sock")
  const { bin, callLog, ready, pidfile } = installBrowserFakes(dir)
  try {
    await leftoverSocket(sock)
    await runBrowser(dir, sock, bin)
    const calls = fs.readFileSync(callLog, "utf8")
    assert.match(calls, /call:serve/)
    assert.equal(calls.includes("chromium:"), false)
    assert.equal(fs.existsSync(ready), true)
    assert.equal(fs.statSync(sock).isSocket(), true)
  } finally {
    if (fs.existsSync(pidfile)) {
      const pid = Number(fs.readFileSync(pidfile, "utf8"))
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // Already gone.
        }
      }
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("browser leaves a live debugging socket in place", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-browser-live-"))
  const sock = path.join(dir, "cdp.sock")
  const { bin, callLog, ready, pidfile } = installBrowserFakes(dir)
  const server = net.createServer((conn) => conn.end())
  await new Promise<void>((resolve) => server.listen(sock, () => resolve()))
  fs.writeFileSync(ready, "1")
  try {
    await runBrowser(dir, sock, bin)
    const calls = fs.readFileSync(callLog, "utf8")
    assert.match(calls, /call:ping/)
    assert.equal(calls.includes("call:serve"), false)
    assert.equal(calls.includes("chromium:"), false)
    assert.equal(fs.statSync(sock).isSocket(), true)
  } finally {
    server.close()
    if (fs.existsSync(pidfile)) {
      const pid = Number(fs.readFileSync(pidfile, "utf8"))
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // Already gone.
        }
      }
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
