import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { encodeSecretFrame } from "./vault-fill"

const helper = path.resolve("workstation/rootfs/usr/local/bin/xiryn-secret-exec")
const secret = "s3cr3t-value-not-a-label"

function frameOf(value: string) {
  const encoded = encodeSecretFrame(value)
  const frame = Buffer.from(encoded.frame)
  encoded.frame.fill(0)
  encoded.secret.fill(0)
  return frame
}

function runHelper(args: string[], value: string, limitMs: number) {
  const child = spawn(helper, args, { stdio: ["pipe", "pipe", "pipe"] })
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
  child.stdin.end(frameOf(value))
  const killer = setTimeout(() => child.kill("SIGKILL"), limitMs)
  const done = once(child, "exit").then(([code]) => {
    clearTimeout(killer)
    return {
      code,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
      pid: child.pid,
    }
  })
  return { child, done }
}

function assertClean(text: string, value: string) {
  assert.equal(text.includes(value), false)
  assert.equal(text.includes(Buffer.from(value).toString("base64")), false)
  assert.equal(text.includes(Buffer.from(value).toString("hex")), false)
  assert.equal(text.includes("/tmp/xiryn/vault"), false)
}

test("the workstation sources no longer hand the model a vault file", () => {
  const workstation = fs.readFileSync("lib/workstation.ts", "utf8")
  const tools = fs.readFileSync("lib/agent/tools.ts", "utf8")
  for (const source of [workstation, tools]) {
    assert.equal(source.includes("writeSecretFile"), false)
    assert.equal(source.includes("/tmp/xiryn/vault"), false)
  }
  assert.equal(workstation.includes("sleep 300"), false)
  assert.match(workstation, /xiryn-secret-exec/)
  assert.match(fs.readFileSync(helper, "utf8"), /assert_pipe_private/)
})

test("stdin reaches the program and the captured text does not", async () => {
  const { done } = runHelper(
    [
      "--via",
      "stdin",
      "--timeout",
      "10",
      "--",
      "python3",
      "-c",
      "import sys; d=sys.stdin.buffer.read(); print(len(d)); print(sum(d))",
    ],
    secret,
    15_000
  )
  const result = await done
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, `24\n2213\n`)
  assertClean(result.stdout + result.stderr, secret)
})

test("an environment variable reaches the program and printenv is redacted", async () => {
  const measure = runHelper(
    [
      "--via",
      "env",
      "--env-name",
      "GH_TOKEN",
      "--timeout",
      "10",
      "--",
      "python3",
      "-c",
      "import os; d=os.environ['GH_TOKEN'].encode(); print(len(d)); print(sum(d))",
    ],
    secret,
    15_000
  )
  const measured = await measure.done
  assert.equal(measured.code, 0, measured.stderr)
  assert.equal(measured.stdout, `24\n2213\n`)
  assertClean(measured.stdout + measured.stderr, secret)

  const printed = await runHelper(
    [
      "--via",
      "env",
      "--env-name",
      "GH_TOKEN",
      "--timeout",
      "10",
      "--",
      "printenv",
      "GH_TOKEN",
    ],
    secret,
    15_000
  ).done
  assert.equal(printed.code, 0, printed.stderr)
  assert.equal(printed.stdout, "[redacted]\n")
  assertClean(printed.stdout + printed.stderr, secret)
})

test("encoded output and a vault path are removed", async () => {
  const script = [
    "import base64,sys",
    "raw=sys.stdin.buffer.read()",
    "sys.stdout.buffer.write(base64.b64encode(raw)+b'\\n')",
    "sys.stdout.buffer.write(raw.hex().encode()+b'\\n')",
    "sys.stdout.buffer.write(b'/tmp/xiryn/vault/v-abc123\\n')",
  ].join(";")
  const { done } = runHelper(
    ["--via", "stdin", "--timeout", "10", "--", "python3", "-c", script],
    secret,
    15_000
  )
  const result = await done
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /\[redacted\]/)
  assertClean(result.stdout + result.stderr, secret)
})

test("a timed-out program is stopped and does not reveal the value", async () => {
  const started = Date.now()
  const { done } = runHelper(
    ["--via", "stdin", "--timeout", "1", "--", "sleep", "30"],
    secret,
    10_000
  )
  const result = await done
  assert.equal(result.code, 124)
  assert.ok(Date.now() - started < 8_000)
  assert.match(result.stdout, /timed out after 1s/)
  assertClean(result.stdout + result.stderr, secret)
})

test("a missing program fails without the value", async () => {
  const { done } = runHelper(
    ["--via", "stdin", "--timeout", "5", "--", "/no/such/xiryn-program"],
    secret,
    10_000
  )
  const result = await done
  assert.equal(result.code, 127)
  assert.match(result.stderr, /not on this machine/)
  assertClean(result.stdout + result.stderr, secret)
})

test("another process cannot read the secret from /proc or a vault file", async () => {
  const value = `probe-${secret}-extra`
  const vaultDir = "/tmp/xiryn/vault"
  const before = fs.existsSync(vaultDir) ? fs.readdirSync(vaultDir) : []
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-secret-"))
  const report = path.join(cwd, "report")
  const child = spawn(
    helper,
    ["--via", "env", "--env-name", "GH_TOKEN", "--timeout", "8", "--", "sleep", "1"],
    { stdio: ["pipe", "pipe", "pipe"], cwd }
  )
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
  if (child.pid === undefined || child.stdin === null) {
    child.kill("SIGKILL")
    throw new Error("The helper did not start.")
  }

  // A separate process spins so it can open the pipe during the short window
  // before the program is locked. The value is not on its command line.
  const scanner = spawn(
    "python3",
    [
      "-c",
      [
        "import os, sys, time",
        "root = int(sys.argv[1])",
        "needle = sys.stdin.buffer.readline().rstrip(b'\\n')",
        "report = sys.argv[2]",
        "opened = []",
        "leaked = False",
        "deadline = time.time() + 1.5",
        "while time.time() < deadline and not opened:",
        "    try:",
        "        kids = open(f'/proc/{root}/task/{root}/children').read().split()",
        "    except OSError:",
        "        kids = []",
        "    for kid in kids:",
        "        for name in ('environ', 'cmdline'):",
        "            try:",
        "                data = open(f'/proc/{kid}/{name}', 'rb').read()",
        "            except OSError:",
        "                continue",
        "            if needle and needle in data:",
        "                leaked = True",
        "        for fdn in ('0', '100'):",
        "            try:",
        "                opened.append(os.open(f'/proc/{kid}/fd/{fdn}', os.O_RDONLY | os.O_NONBLOCK))",
        "            except OSError:",
        "                pass",
        "end = time.time() + 3",
        "while time.time() < end and os.path.exists(f'/proc/{root}'):",
        "    time.sleep(0.01)",
        "blob = b''",
        "for fd in opened:",
        "    try:",
        "        blob += os.read(fd, 65536)",
        "    except OSError:",
        "        pass",
        "    os.close(fd)",
        "if needle and needle in blob:",
        "    leaked = True",
        "open(report, 'w').write(f'opened={len(opened)} leaked={int(leaked)}\\n')",
      ].join("\n"),
      String(child.pid),
      report,
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  )
  scanner.stdin?.end(`${value}\n`)

  child.stdin.end(frameOf(value))
  const killer = setTimeout(() => {
    child.kill("SIGKILL")
    scanner.kill("SIGKILL")
  }, 12_000)
  const [code] = await once(child, "exit")
  await once(scanner, "exit")
  clearTimeout(killer)

  const stdout = Buffer.concat(out).toString("utf8")
  const stderr = Buffer.concat(err).toString("utf8")
  const status = fs.readFileSync(report, "utf8")
  assert.match(status, /leaked=0/)
  assert.equal(status.includes(value), false)
  assertClean(stdout + stderr, value)
  assert.equal(fs.readdirSync(cwd).filter((name) => name !== "report").length, 0)
  const after = fs.existsSync(vaultDir) ? fs.readdirSync(vaultDir) : []
  assert.deepEqual(after, before)
  fs.rmSync(cwd, { recursive: true, force: true })
  // Opening the pipe before the lock must make the helper refuse to write.
  // If the scanner loses that race, the program runs and /proc stays unreadable.
  if (status.startsWith("opened=0 ")) {
    assert.equal(code, 0, stderr)
  } else {
    assert.equal(code, 1)
    assert.match(stderr, /Couldn't keep the secret private/)
  }
})
