import assert from "node:assert/strict"
import { test } from "node:test"

import { addCheckpoints, supportsCachePoints } from "./prompt-cache"

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
