import assert from "node:assert/strict"
import { test } from "node:test"

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

import {
  addCheckpoints,
  addOpenRouterCacheControl,
  supportsCachePoints,
  supportsOpenRouterClaudeCache,
} from "./prompt-cache"

test("checkpoints go on the system prompt and the last message only", () => {
  const prompt = [
    { role: "system", content: "s" },
    { role: "user", content: [] },
    { role: "assistant", content: [] },
    { role: "tool", content: [] },
  ] as { role: string; content: unknown; providerOptions?: Record<string, unknown> }[]
  const out = addCheckpoints(prompt)
  const marked = out.map((m) => m.providerOptions !== undefined)
  assert.deepEqual(marked, [true, false, false, true])
  assert.deepEqual(out[3].providerOptions, {
    bedrock: { cachePoint: { type: "default" } },
  })
  assert.equal(prompt[0].providerOptions, undefined) // input is not mutated
})

test("existing provider options are kept", () => {
  const out = addCheckpoints([
    {
      role: "user",
      content: [],
      providerOptions: { bedrock: { other: 1 }, x: { y: 2 } },
    },
  ])
  assert.deepEqual(out[0].providerOptions, {
    bedrock: { cachePoint: { type: "default" } },
    x: { y: 2 },
  })
})

test("only models that accept checkpoints are wrapped", () => {
  assert.equal(supportsCachePoints("eu.anthropic.claude-sonnet-4-6"), true)
  assert.equal(supportsCachePoints("eu.amazon.nova-pro-v1:0"), true)
  assert.equal(supportsCachePoints("eu.meta.llama3-1-70b-instruct-v1:0"), false)
  assert.equal(supportsCachePoints("openai.gpt-oss-120b-1:0"), false)
})

test("only OpenRouter Claude ids get an explicit cache marker", () => {
  assert.equal(supportsOpenRouterClaudeCache("anthropic/claude-sonnet-4.6"), true)
  assert.equal(supportsOpenRouterClaudeCache("anthropic/claude-opus-4.5"), true)
  assert.equal(supportsOpenRouterClaudeCache("openai/gpt-5"), false)
  assert.equal(supportsOpenRouterClaudeCache("google/gemini-2.5-pro"), false)
  assert.equal(supportsOpenRouterClaudeCache("deepseek/deepseek-chat"), false)
  assert.equal(supportsOpenRouterClaudeCache("claude-sonnet-4-6"), false)
})

test("openrouter cache_control is top-level and does not mutate the input", () => {
  const input = { openai: { user: "a" } }
  const out = addOpenRouterCacheControl(input)
  assert.deepEqual(out, {
    openai: { user: "a" },
    openrouter: { cache_control: { type: "ephemeral" } },
  })
  assert.equal("openrouter" in input, false)
  assert.deepEqual(addOpenRouterCacheControl(undefined), {
    openrouter: { cache_control: { type: "ephemeral" } },
  })
})

test("existing openrouter options and an explicit cache_control stay", () => {
  const out = addOpenRouterCacheControl({
    openrouter: {
      provider: { order: ["anthropic"] },
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  })
  assert.deepEqual(out.openrouter, {
    provider: { order: ["anthropic"] },
    cache_control: { type: "ephemeral", ttl: "1h" },
  })
})

test("the openrouter client copies cache_control onto the request body", async () => {
  const model = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
  }).chatModel("anthropic/claude-sonnet-4.6")
  const prepared = await (
    model as unknown as {
      getArgs: (options: {
        prompt: []
        providerOptions: ReturnType<typeof addOpenRouterCacheControl>
      }) => Promise<{ args: { cache_control?: unknown; user?: unknown } }>
    }
  ).getArgs({
    prompt: [],
    providerOptions: addOpenRouterCacheControl({
      openrouter: { user: "xiryn" },
    }),
  })
  assert.deepEqual(prepared.args.cache_control, { type: "ephemeral" })
  assert.equal(prepared.args.user, "xiryn")
})
