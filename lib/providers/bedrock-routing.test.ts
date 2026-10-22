import assert from "node:assert/strict"
import { test } from "node:test"

import {
  bedrockMaxOutputTokens,
  bedrockStreamsWithTools,
  parseExtraRegions,
  parseMaxOutputOverrides,
  parseModelRegionMap,
  resolveBedrockRegion,
} from "./bedrock-routing"

test("extra regions are a list of region ids", () => {
  assert.deepEqual(parseExtraRegions("us-east-2"), ["us-east-2"])
  assert.deepEqual(parseExtraRegions(" us-east-2, eu-west-1 "), [
    "us-east-2",
    "eu-west-1",
  ])
  assert.deepEqual(parseExtraRegions(""), [])
  assert.throws(() => parseExtraRegions("ohio"), /us-east-2/)
})

test("model region map pins an id without moving the default", () => {
  const map = parseModelRegionMap(
    "meta.llama3-3-70b-instruct-v1:0=us-east-2, eu.amazon.nova-pro-v1:0=eu-central-1"
  )
  assert.equal(map["meta.llama3-3-70b-instruct-v1:0"], "us-east-2")
  assert.equal(map["eu.amazon.nova-pro-v1:0"], "eu-central-1")
  assert.equal(
    resolveBedrockRegion("eu.anthropic.claude-sonnet-4-6", {
      defaultRegion: "eu-west-3",
      extraRegions: ["us-east-2"],
      modelRegions: map,
    }),
    "eu-west-3"
  )
  assert.equal(
    resolveBedrockRegion("meta.llama3-3-70b-instruct-v1:0", {
      defaultRegion: "eu-west-3",
      extraRegions: ["us-east-2"],
      modelRegions: {},
    }),
    "us-east-2"
  )
})

test("output caps follow the model", () => {
  assert.equal(bedrockMaxOutputTokens("eu.anthropic.claude-sonnet-4-6"), 16_384)
  assert.equal(bedrockMaxOutputTokens("eu.amazon.nova-pro-v1:0"), 10_000)
  assert.equal(bedrockMaxOutputTokens("eu.amazon.nova-lite-v1:0"), 10_000)
  assert.equal(bedrockMaxOutputTokens("eu.amazon.nova-micro-v1:0"), 10_000)
  assert.equal(bedrockMaxOutputTokens("meta.llama3-3-70b-instruct-v1:0"), 4_096)
  assert.equal(bedrockMaxOutputTokens("us.meta.llama3-3-70b-instruct-v1:0"), 4_096)
  assert.equal(
    bedrockMaxOutputTokens("eu.amazon.nova-pro-v1:0", {
      "eu.amazon.nova-pro-v1:0": 8_000,
    }),
    8_000
  )
})

test("llama 3.3 cannot mix tools with streaming", () => {
  assert.equal(bedrockStreamsWithTools("eu.anthropic.claude-sonnet-4-6"), true)
  assert.equal(bedrockStreamsWithTools("meta.llama3-3-70b-instruct-v1:0"), false)
  assert.equal(bedrockStreamsWithTools("us.meta.llama3-3-70b-instruct-v1:0"), false)
})

test("output override syntax is checked", () => {
  assert.deepEqual(parseMaxOutputOverrides("eu.amazon.nova-pro-v1:0=8000"), {
    "eu.amazon.nova-pro-v1:0": 8000,
  })
  assert.throws(() => parseMaxOutputOverrides("nova=lots"))
})
