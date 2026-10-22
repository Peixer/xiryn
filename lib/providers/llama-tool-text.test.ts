import assert from "node:assert/strict"
import { test } from "node:test"

import { extractLlamaTextToolCalls, liftLlamaTextToolCalls } from "./llama-tool-text"
import { resolveBedrockRegion } from "./bedrock-routing"

const tools = new Set(["shell", "fs_read"])

test("parses a function call with command and cwd", () => {
  const text =
    '{"type": "function", "name": "shell", "parameters": {"command": "date", "cwd": "/tmp"}}'
  const parts = extractLlamaTextToolCalls(text, tools)
  assert.deepEqual(parts, [
    {
      type: "tool-call",
      toolCallId: "llama-0-shell",
      toolName: "shell",
      input: JSON.stringify({ command: "date", cwd: "/tmp" }),
    },
  ])
})

test("parses name and parameters, arguments, and a JSON string", () => {
  const nameOnly = extractLlamaTextToolCalls(
    '{"name":"fs_read","parameters":{"path":"/etc/hostname"}}',
    tools
  )
  assert.equal(nameOnly?.[0].type, "tool-call")
  assert.equal(nameOnly?.[0].type === "tool-call" && nameOnly[0].toolName, "fs_read")

  const args = extractLlamaTextToolCalls(
    '{"name":"shell","arguments":{"command":"uname"}}',
    tools
  )
  assert.equal(args?.[0].type === "tool-call" && args[0].input, '{"command":"uname"}')

  const encoded = extractLlamaTextToolCalls(
    '{"type":"function","name":"shell","parameters":"{\\"command\\":\\"date\\"}"}',
    tools
  )
  assert.equal(
    encoded?.[0].type === "tool-call" && encoded[0].input,
    '{"command":"date"}'
  )
})

test("parses two calls in one reply", () => {
  const parts = extractLlamaTextToolCalls(
    '{"name":"shell","parameters":{"command":"date"}} then {"name":"fs_read","parameters":{"path":"a"}}',
    tools
  )
  assert.deepEqual(
    parts?.map((part) => (part.type === "tool-call" ? part.toolName : part.text)),
    ["shell", "then", "fs_read"]
  )
})

test("parses a python tag, a code fence, and surrounding prose", () => {
  const tagged = extractLlamaTextToolCalls(
    'Checking now.\n<|python_tag|>{"name":"shell","parameters":{"command":"date"}}\nThanks.',
    tools
  )
  assert.deepEqual(
    tagged?.map((part) => (part.type === "text" ? part.text : part.toolName)),
    ["Checking now.", "shell", "Thanks."]
  )

  const fenced = extractLlamaTextToolCalls(
    '```json\n{"type":"function","name":"shell","parameters":{"command":"date"}}\n```',
    tools
  )
  assert.equal(fenced?.length, 1)
  assert.equal(fenced?.[0].type, "tool-call")
})

test("ignores unrelated JSON and tools that were not offered", () => {
  assert.equal(extractLlamaTextToolCalls('{"command":"date"}', tools), null)
  assert.equal(
    extractLlamaTextToolCalls(
      '{"type":"function","name":"send_mail","parameters":{"to":"a@b.c"}}',
      tools
    ),
    null
  )
})

test("lifts text into a tool call and marks the finish reason", () => {
  const lifted = liftLlamaTextToolCalls(
    {
      content: [
        {
          type: "text",
          text: '{"type":"function","name":"shell","parameters":{"command":"date"}}',
        },
      ],
      finishReason: { unified: "stop", raw: "end_turn" },
    },
    tools
  )
  const call = lifted.content[0] as { type: string; toolName?: string }
  assert.equal(call.type, "tool-call")
  assert.equal(call.toolName, "shell")
  assert.equal(
    lifted.finishReason &&
      typeof lifted.finishReason === "object" &&
      lifted.finishReason.unified,
    "tool-calls"
  )
})

test("leaves a native toolUse block untouched", () => {
  const native = {
    content: [
      {
        type: "tool-call",
        toolCallId: "real",
        toolName: "shell",
        input: '{"command":"date"}',
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool_use" },
  }
  assert.equal(liftLlamaTextToolCalls(native, tools), native)
})

test("Ohio Llama stays in us-east-2 while Claude stays in the default region", () => {
  assert.equal(
    resolveBedrockRegion("meta.llama3-3-70b-instruct-v1:0", {
      defaultRegion: "eu-west-3",
      extraRegions: ["us-east-2"],
      modelRegions: {},
    }),
    "us-east-2"
  )
  assert.equal(
    resolveBedrockRegion("eu.anthropic.claude-sonnet-4-6", {
      defaultRegion: "eu-west-3",
      extraRegions: ["us-east-2"],
      modelRegions: {},
    }),
    "eu-west-3"
  )
})
