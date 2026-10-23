import assert from "node:assert/strict"
import { test } from "node:test"

import { findPrice, type Price } from "./pricing"

function priced(
  spec: string,
  custom?: Record<string, { input: number; output: number }>
) {
  const price = findPrice(spec, custom ? { custom } : {})
  assert.equal(price?.kind, "priced")
  return price as Extract<Price, { kind: "priced" }>
}

test("bedrock/us.<base> reuses the eu price and flags it as an estimate", () => {
  const eu = priced("bedrock/eu.anthropic.claude-sonnet-5-5")
  const us = priced("bedrock/us.anthropic.claude-sonnet-5-5")
  assert.equal(eu.source, "catalog")
  assert.equal(us.source, "estimate")
  assert.deepEqual(us.price, eu.price)
  assert.deepEqual(us.price, { input: 2, cached: 0.1, output: 10 })

  for (const spec of [
    "bedrock/global.anthropic.claude-sonnet-4-6",
    "bedrock/apac.anthropic.claude-haiku-4-5-20251001-v1:0",
    "bedrock/anthropic.claude-sonnet-5",
  ]) {
    const row = priced(spec)
    assert.equal(row.source, "estimate")
  }

  const haiku = priced("bedrock/us.anthropic.claude-haiku-5-5")
  assert.equal(haiku.source, "estimate")
  assert.equal(haiku.price.long?.above, 100_000)
  assert.equal(haiku.price.long?.input, 0.5)
})

test("exact eu. Bedrock rows stay catalog prices", () => {
  const sonnet = priced("bedrock/eu.anthropic.claude-sonnet-4-6")
  assert.equal(sonnet.source, "catalog")
  assert.deepEqual(sonnet.price, { input: 3, cached: 0.3, output: 15 })

  const nova = priced("bedrock/eu.amazon.nova-pro-v1:0")
  assert.equal(nova.source, "catalog")
  assert.deepEqual(nova.price, { input: 1.18, cached: 0.295, output: 4.72 })
})

test("US Nova uses the published US rate, not an estimate of Paris", () => {
  const pro = priced("bedrock/us.amazon.nova-pro-v1:0")
  assert.equal(pro.source, "catalog")
  assert.deepEqual(pro.price, { input: 0.8, cached: 0.2, output: 3.2 })
  assert.notDeepEqual(pro.price, priced("bedrock/eu.amazon.nova-pro-v1:0").price)

  assert.deepEqual(priced("bedrock/us.amazon.nova-lite-v1:0").price, {
    input: 0.06,
    cached: 0.015,
    output: 0.24,
  })
  assert.deepEqual(priced("bedrock/us.amazon.nova-micro-v1:0").price, {
    input: 0.035,
    cached: 0.00875,
    output: 0.14,
  })
})

test("Nova prefixes without a single published rate stay unpriced", () => {
  assert.equal(findPrice("bedrock/apac.amazon.nova-pro-v1:0"), null)
  assert.equal(findPrice("bedrock/global.amazon.nova-lite-v1:0"), null)
  assert.equal(findPrice("bedrock/amazon.nova-micro-v1:0"), null)
})

test("an unknown Bedrock model stays unpriced", () => {
  assert.equal(findPrice("bedrock/us.amazon.titan-tg1-large"), null)
  assert.equal(findPrice("bedrock/not-a-real-model"), null)
  assert.equal(findPrice("bedrock/us-gov.anthropic.claude-sonnet-5-5"), null)
})

test("a custom price wins over a Bedrock estimate", () => {
  const custom = { input: 9, output: 11 }
  const row = priced("bedrock/us.anthropic.claude-sonnet-5-5", {
    "bedrock/us.anthropic.claude-sonnet-5-5": custom,
  })
  assert.equal(row.source, "custom")
  assert.deepEqual(row.price, custom)

  const borrowed = priced("bedrock/global.anthropic.claude-sonnet-5-5", {
    "bedrock/eu.anthropic.claude-sonnet-5-5": custom,
  })
  assert.equal(borrowed.source, "estimate")
  assert.equal(borrowed.price.input, 2)
})

test("OpenRouter lookups are unchanged", () => {
  const via = findPrice("openrouter/anthropic/claude-sonnet-5.5")
  const direct = findPrice("anthropic/claude-sonnet-5-5")
  assert.deepEqual(via, direct)
  assert.equal(via?.kind, "priced")
  if (via?.kind === "priced") assert.equal(via.source, "catalog")

  const mini = priced("openai/gpt-4o-mini")
  assert.equal(mini.source, "catalog")
  assert.deepEqual(mini.price, { input: 0.15, cached: 0.075, output: 0.6 })

  const routed = findPrice("openrouter/openai/gpt-4o-mini")
  assert.deepEqual(routed, findPrice("openai/gpt-4o-mini"))
})
