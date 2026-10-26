import assert from "node:assert/strict"
import { test } from "node:test"

import { formatAudit } from "./audit"
import { redact, redactForStorage } from "./redact"

const githubPat = `ghp_${"A".repeat(36)}`
const githubFine = `github_pat_${"a".repeat(22)}_${"b".repeat(59)}`
const openai = `sk-proj-${"c".repeat(40)}`
const anthropic = `sk-ant-api03-${"d".repeat(40)}`
const awsAccess = "ASIAIOSFODNN7EXAMPLE"
const awsSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
const credentialUrl = "https://octocat:s3cr3t-token@github.com/acme/private.git"

test("progress and audit text do not keep secrets", () => {
  const raw =
    "OPENAI_API_KEY=sk-live failed Bearer abcdefghijklmnop AWS AKIAIOSFODNN7EXAMPLE"
  const cleaned = redact(raw)
  assert.doesNotMatch(cleaned, /sk-live/)
  assert.doesNotMatch(cleaned, /abcdefghijklmnop/)
  assert.doesNotMatch(cleaned, /AKIAIOSFODNN7EXAMPLE/)
  const line = formatAudit({
    ts: "2026-10-24T00:00:00.000Z",
    op: "switch",
    result: "failed",
    actor: "helper",
    sha: "a".repeat(40),
    active: "blue",
    candidate: "green",
    error: "TELEGRAM_BOT_TOKEN=123456:ABC",
  })
  assert.doesNotMatch(line, /123456:ABC/)
  assert.match(line, /\[redacted\]/)
})

test("redacts provider tokens, credential URLs, and private keys", () => {
  const pem = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA7secretmaterial",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n")
  const raw = [
    `token ${githubPat}`,
    `fine ${githubFine}`,
    `openai ${openai}`,
    `anthropic ${anthropic}`,
    `aws ${awsAccess}`,
    `AWS_SECRET_ACCESS_KEY=${awsSecret}`,
    `clone ${credentialUrl}`,
    "plain https://github.com/acme/private.git",
    pem,
  ].join("\n")
  const cleaned = redact(raw)
  for (const secret of [
    githubPat,
    githubFine,
    openai,
    anthropic,
    awsAccess,
    awsSecret,
    "s3cr3t-token",
    "octocat:",
    "MIIEowIBAAKCAQEA7secretmaterial",
  ]) {
    assert.equal(cleaned.includes(secret), false, secret)
  }
  assert.match(cleaned, /https:\/\/\[redacted\]@github.com\/acme\/private.git/)
  assert.match(cleaned, /https:\/\/github.com\/acme\/private.git/)
  assert.equal(redact(cleaned), cleaned)
})

test("a secret split across chunks is withheld until it can be redacted", () => {
  let raw = ""
  const push = (chunk: string, flush = false) => {
    raw += chunk
    return redactForStorage(raw, flush)
  }
  const partial = githubPat.slice(0, 12)
  const held = push(`log ${partial}`)
  assert.equal(held.includes("ghp_"), false)
  assert.match(held, /^log /)
  const complete = push(githubPat.slice(12))
  assert.equal(complete.includes(githubPat), false)
  assert.match(complete, /\[redacted\]/)

  raw = ""
  const urlHead = "https://octocat:s3"
  assert.equal(push(`clone ${urlHead}`).includes("s3"), false)
  const urlDone = push("cr3t-token@github.com/acme/private.git\n")
  assert.equal(urlDone.includes("s3cr3t-token"), false)
  assert.match(urlDone, /https:\/\/\[redacted\]@github.com\/acme\/private.git/)

  raw = ""
  const pemHead = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7secretmaterial\n"
  assert.equal(push(pemHead).includes("MIIEow"), false)
  const pemDone = push("-----END RSA PRIVATE KEY-----\n")
  assert.equal(pemDone.includes("MIIEow"), false)
  assert.match(pemDone, /\[redacted\]/)

  raw = `tail ${openai}`
  assert.equal(redactForStorage(raw, true).includes(openai), false)
})
