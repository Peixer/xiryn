import assert from "node:assert/strict"
import { test } from "node:test"

import { pageFromTargets } from "./page-origin"
import { sameSite } from "./etld"
import {
  assessLoginFill,
  loginApprovalArgs,
  vaultFillForModel,
  vaultFillOutput,
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
  })
  assert.equal(JSON.stringify({ step, args }).includes(secret), false)
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
