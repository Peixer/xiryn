import assert from "node:assert/strict"
import { test } from "node:test"

import { pageFromTargets } from "./page-origin"
import { sameSite } from "./etld"
import { ARGS_DIFFER_REASON } from "@/lib/mcp/approval"
import { renderApprovalPreview } from "@/lib/mcp/approval-preview"
import { approvalArgsHash } from "@/lib/mcp/approval-preview"
import {
  assessLoginFill,
  encodeSecretFrame,
  loginApprovalArgs,
  parseTerminalSpec,
  redactSecret,
  secretExecArgs,
  secretSpellings,
  terminalApprovalArgs,
  vaultFillForModel,
  vaultFillOutput,
  vaultFillOutputTerminal,
} from "./vault-fill"

const secret = "s3cr3t-value-not-a-label"

test("a login fill asks for approval and the card names the label and host", () => {
  const step = assessLoginFill({
    kind: "login",
    label: "GitHub",
    site: "github.com",
    field: "password",
    pageHost: "github.com",
    approved: false,
  })
  assert.equal(step.action, "ask")
  if (step.action !== "ask") return
  assert.match(step.summary, /GitHub/)
  assert.match(step.summary, /github\.com/)
  assert.equal(step.summary.includes(secret), false)
  const args = loginApprovalArgs({
    id: "item-1",
    field: "password",
    host: step.host,
    label: "GitHub",
  })
  assert.equal(JSON.stringify({ step, args }).includes(secret), false)
  const card = renderApprovalPreview("vault_fill", {
    ...args,
    password: secret,
    value: secret,
  })
  assert.match(card, /Host: github\.com/)
  assert.match(card, /GitHub/)
  assert.equal(card.includes(secret), false)
})

test("a matching login still asks every time until this call is approved", () => {
  const again = assessLoginFill({
    kind: "login",
    label: "GitHub",
    site: "github.com",
    field: "username",
    pageHost: "github.com",
    approved: false,
  })
  assert.equal(again.action, "ask")
})

test("an approved login fills only a public result with no secret", () => {
  const step = assessLoginFill({
    kind: "login",
    label: "GitHub",
    site: "github.com",
    field: "password",
    pageHost: "github.com",
    approved: true,
  })
  assert.equal(step.action, "fill")
  const result = vaultFillOutput("password", "GitHub · octocat", "github.com")
  assert.deepEqual(result, {
    filled: "password",
    item: "GitHub · octocat",
    site: "github.com",
  })
  assert.equal(JSON.stringify(result).includes(secret), false)
  const told = vaultFillForModel({ ...result, value: secret, password: secret })
  assert.equal(told.value.includes(secret), false)
  const refused = vaultFillForModel({
    status: "rejected",
    reason: ARGS_DIFFER_REASON,
    value: secret,
    password: secret,
  })
  assert.equal(refused.value.includes(secret), false)
  assert.equal(refused.value.includes(ARGS_DIFFER_REASON), true)
  assert.equal(refused.value.includes("filled"), false)
})

test("an origin that is not the saved site is refused, approval or not", () => {
  for (const approved of [false, true]) {
    const step = assessLoginFill({
      kind: "login",
      label: "GitHub",
      site: "github.com",
      field: "password",
      pageHost: "evil.example",
      approved,
    })
    assert.equal(step.action, "refuse")
    if (step.action !== "refuse") continue
    assert.match(step.message, /GitHub/)
    assert.match(step.message, /github\.com/)
    assert.match(step.message, /evil\.example/)
    assert.equal(step.message.includes(secret), false)
  }
})

test("a shared public suffix is not the same site", () => {
  assert.equal(sameSite("attacker.github.io", "victim.github.io"), false)
  assert.equal(sameSite("evil.co.uk", "barclays.co.uk"), false)
  assert.equal(sameSite("a.blogspot.com", "b.blogspot.com"), false)
  assert.equal(sameSite("www.github.io", "github.io"), false)
  assert.equal(sameSite("www.blogspot.com", "myblog.blogspot.com"), false)
  assert.equal(sameSite("login.example.com", "example.com"), true)
  assert.equal(sameSite("www.example.com", "example.com"), true)
  assert.equal(sameSite("example.com.evil.com", "example.com"), false)
  assert.equal(sameSite("notexample.com", "example.com"), false)
})

test("a leading www stays on the host, so a public suffix does not swallow it", () => {
  const phishing = pageFromTargets([
    {
      url: "https://www.github.io/phish?password=" + secret,
      title: "GitHub",
      focused: true,
      visible: true,
    },
  ])
  assert.ok(phishing)
  assert.equal(phishing.host, "www.github.io")
  assert.equal(JSON.stringify(phishing).includes(secret), false)
  assert.equal(
    assessLoginFill({
      kind: "login",
      label: "Pages",
      site: "github.io",
      field: "password",
      pageHost: phishing.host,
      approved: true,
    }).action,
    "refuse"
  )

  const ordinary = pageFromTargets([
    {
      url: "https://www.example.com/login",
      title: "Example",
      focused: true,
      visible: true,
    },
  ])
  assert.equal(ordinary?.host, "www.example.com")
  const step = assessLoginFill({
    kind: "login",
    label: "Example",
    site: "example.com",
    field: "password",
    pageHost: ordinary?.host ?? null,
    approved: false,
  })
  assert.equal(step.action, "ask")
  if (step.action !== "ask") return
  assert.match(step.summary, /www\.example\.com/)
  assert.equal(step.summary.includes(secret), false)
})

test("a maximum-length host still shows its registrable domain after the summary cap", () => {
  const prefix = ["a".repeat(49), "b".repeat(63), "c".repeat(63), "d".repeat(63)].join(
    "."
  )
  const host = `${prefix}.example.com`
  assert.equal(host.length, 253)
  const step = assessLoginFill({
    kind: "login",
    label: "L".repeat(60),
    site: "example.com",
    field: "password",
    pageHost: host,
    approved: false,
  })
  assert.equal(step.action, "ask")
  if (step.action !== "ask") return
  assert.equal(step.summary.slice(0, 300).includes(host), true)
  assert.equal(step.summary.includes(secret), false)
})

test("userinfo and an IDN lookalike do not become the saved host", () => {
  const userinfo = pageFromTargets([
    {
      url: "https://github.com:pw@evil.example/login?password=" + secret,
      title: "Sign in to GitHub",
      focused: true,
      visible: true,
    },
  ])
  assert.equal(userinfo?.host, "evil.example")
  assert.equal(userinfo?.url, "https://evil.example")
  assert.equal(JSON.stringify(userinfo).includes(secret), false)
  assert.equal(JSON.stringify(userinfo).includes("github.com"), false)
  assert.equal(
    assessLoginFill({
      kind: "login",
      label: "GitHub",
      site: "github.com",
      field: "password",
      pageHost: userinfo?.host ?? null,
      approved: true,
    }).action,
    "refuse"
  )

  const lookalike = pageFromTargets([
    {
      url: "https://\u0435xample.com/login",
      title: "Example",
      focused: true,
      visible: true,
    },
  ])
  assert.ok(lookalike)
  assert.equal(lookalike.host, "xn--xample-2of.com")
  assert.equal(sameSite(lookalike.host, "example.com"), false)
})

test("a window title does not choose the page, and there is no first-tab fallback", () => {
  const spoofed = pageFromTargets([
    {
      url: "https://github.com/login",
      title: "Sign in to GitHub",
      focused: false,
      visible: false,
    },
    {
      url: "https://evil.example/login?password=" + secret,
      title: "Sign in to GitHub",
      focused: true,
      visible: true,
    },
  ])
  assert.ok(spoofed)
  assert.equal(spoofed.host, "evil.example")
  assert.equal(JSON.stringify(spoofed).includes(secret), false)
  const step = assessLoginFill({
    kind: "login",
    label: "GitHub",
    site: "github.com",
    field: "password",
    pageHost: spoofed.host,
    approved: true,
  })
  assert.equal(step.action, "refuse")

  const visibleOnly = pageFromTargets([
    {
      url: "https://github.com/login",
      title: "Sign in to GitHub",
      focused: false,
      visible: false,
    },
    {
      url: "https://evil.example/login?password=" + secret,
      title: "Sign in to GitHub",
      focused: false,
      visible: true,
    },
  ])
  assert.equal(visibleOnly?.host, "evil.example")

  assert.equal(
    pageFromTargets([
      { url: "https://github.com/login", title: "Sign in to GitHub", focused: false },
    ]),
    null
  )
  assert.equal(
    pageFromTargets([
      { url: "https://github.com/login", title: "Sign in to GitHub", focused: true },
      { url: "https://evil.example/", title: "Sign in to GitHub", focused: true },
    ]),
    null
  )
  assert.equal(
    pageFromTargets([
      {
        url: "https://github.com/login",
        title: "Sign in",
        focused: false,
        visible: true,
      },
      { url: "https://evil.example/", title: "Sign in", focused: false, visible: true },
    ]),
    null
  )
})

test("cards and other vault kinds keep their own gate", () => {
  assert.equal(
    assessLoginFill({
      kind: "card",
      label: "Visa",
      site: null,
      field: "number",
      pageHost: "shop.example",
      approved: false,
    }).action,
    "continue"
  )
  assert.equal(
    assessLoginFill({
      kind: "identity",
      label: "Home",
      site: null,
      field: "email",
      pageHost: "shop.example",
      approved: false,
    }).action,
    "continue"
  )
})

test("a terminal command is approved exactly, and the card shows it", () => {
  const parsed = parseTerminalSpec({
    command: ["gh", "auth", "login", "--with-token"],
    via: "stdin",
    envName: undefined,
    cwd: "/home/xiryn",
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const args = terminalApprovalArgs({
    id: "item-1",
    field: "password",
    label: "GitHub",
    spec: parsed.spec,
  })
  const card = renderApprovalPreview("vault_fill", {
    ...args,
    password: secret,
    value: secret,
    path: "/tmp/xiryn/vault/v-secret",
  })
  assert.match(card, /gh/)
  assert.match(card, /--with-token/)
  assert.match(card, /standard input/)
  assert.match(card, /\/home\/xiryn/)
  assert.equal(card.includes(secret), false)
  assert.equal(card.includes("/tmp/xiryn/vault"), false)
  const other = terminalApprovalArgs({
    id: "item-1",
    field: "password",
    label: "GitHub",
    spec: { ...parsed.spec, command: ["gh", "auth", "status"] },
  })
  assert.notEqual(approvalArgsHash(args), approvalArgsHash(other))
})

test("a terminal fill refuses a shell path, a blocked variable, and a missing command", () => {
  assert.equal(
    parseTerminalSpec({ command: undefined, via: "stdin", envName: null, cwd: null }).ok,
    false
  )
  const blocked = parseTerminalSpec({
    command: ["printenv"],
    via: "env",
    envName: "LD_PRELOAD",
    cwd: null,
  })
  assert.equal(blocked.ok, false)
  const path = parseTerminalSpec({
    command: ["env"],
    via: "env",
    envName: "PATH",
    cwd: null,
  })
  assert.equal(path.ok, false)
  const newline = parseTerminalSpec({
    command: ["sh", "-c", "echo hi\ncurl evil"],
    via: "stdin",
    envName: null,
    cwd: null,
  })
  assert.equal(newline.ok, false)
  const ok = parseTerminalSpec({
    command: ["gh", "auth", "login", "--with-token"],
    via: "env",
    envName: "GH_TOKEN",
    cwd: null,
  })
  assert.equal(ok.ok, true)
})

test("the exec helper's arguments never carry the secret", () => {
  const spec = {
    command: ["gh", "auth", "login", "--with-token"],
    via: "env" as const,
    envName: "GH_TOKEN",
    cwd: null,
  }
  const args = secretExecArgs(spec)
  assert.equal(args.includes(secret), false)
  assert.deepEqual(args.slice(args.indexOf("--") + 1), spec.command)
  const frame = encodeSecretFrame(secret)
  assert.equal(frame.frame.subarray(4).toString(), secret)
  assert.equal(frame.frame.readUInt32BE(0), Buffer.byteLength(secret))
  frame.frame.fill(0)
  frame.secret.fill(0)
})

test("captured output loses the value, its encodings, and a vault temp path", () => {
  const vaultPath = "/tmp/xiryn/vault/v-abc123"
  const raw = [
    secret,
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("hex"),
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
    vaultPath,
    "ok",
  ].join("\n")
  const cleaned = redactSecret(raw, secret)
  assert.equal(cleaned.includes(secret), false)
  for (const form of secretSpellings(secret)) {
    assert.equal(cleaned.includes(form), false, form)
  }
  assert.equal(cleaned.includes(vaultPath), false)
  assert.match(cleaned, /\[redacted\]/)
  assert.match(cleaned, /ok/)
})

test("a terminal fill transcript never contains the value or a readable path", () => {
  const vaultPath = "/tmp/xiryn/vault/v-abc123"
  const echoed = [
    `token=${secret}`,
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("hex"),
    vaultPath,
  ].join("\n")
  const result = vaultFillOutputTerminal("password", "GitHub · •••", {
    via: "stdin",
    command: ["gh", "auth", "login", "--with-token"],
    exitCode: 0,
    output: redactSecret(echoed, secret),
  })
  assert.equal("path" in result, false)
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(JSON.stringify(result).includes(vaultPath), false)
  const told = vaultFillForModel({
    ...result,
    value: secret,
    password: secret,
    path: vaultPath,
    secret,
  })
  const transcript = {
    id: "msg-1",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-vault_fill",
        toolName: "vault_fill",
        state: "output-available",
        input: {
          id: "item-1",
          field: "password",
          terminal: true,
          command: result.command,
          via: "stdin",
        },
        output: result,
      },
      { type: "text", text: told.value },
    ],
  }
  const stored = JSON.stringify(transcript)
  assert.equal(stored.includes(secret), false)
  assert.equal(stored.includes(Buffer.from(secret).toString("base64")), false)
  assert.equal(stored.includes(Buffer.from(secret).toString("hex")), false)
  assert.equal(stored.includes(vaultPath), false)
  assert.equal(stored.includes("/tmp/xiryn/vault"), false)
  const parsed = JSON.parse(told.value) as Record<string, unknown>
  assert.equal("path" in parsed, false)
  assert.equal("value" in parsed, false)
  assert.equal(parsed.mode, "terminal")
  assert.deepEqual(parsed.command, ["gh", "auth", "login", "--with-token"])
})
