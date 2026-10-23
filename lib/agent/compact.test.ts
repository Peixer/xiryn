import assert from "node:assert/strict"
import { test } from "node:test"

import type { ModelMessage } from "ai"

import { compactContext } from "./compact"

const big = (i: number) => `result ${i} ` + "x".repeat(2000)

function history(results: number): ModelMessage[] {
  const out: ModelMessage[] = [{ role: "user", content: "go" }]
  for (let i = 0; i < results; i++) {
    out.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `c${i}`,
          toolName: "shell",
          output: { type: "text", value: big(i) },
        },
      ],
    })
  }
  return out
}

function whole(messages: ModelMessage[]) {
  return messages
    .filter((m) => m.role === "tool")
    .map((m) => {
      const part = (m as { content: { output: { value: string } }[] }).content[0]
      return part.output.value.length > 1000
    })
}

test("a short history is left whole", () => {
  assert.ok(whole(compactContext(history(6))).every(Boolean))
})

test("the sliding window keeps exactly the newest 6", () => {
  const w = whole(compactContext(history(10), false))
  assert.deepEqual(w, [false, false, false, false, true, true, true, true, true, true])
})

test("the chunked window only changes every 6 results", () => {
  const stubbed = (n: number) =>
    whole(compactContext(history(n))).filter((x) => !x).length
  assert.deepEqual([6, 7, 11, 12, 13, 17, 18].map(stubbed), [0, 0, 0, 6, 6, 6, 12])
})

test("between jumps the prefix is byte-identical, so the cache can read it", () => {
  const a = JSON.stringify(compactContext(history(13)))
  const b = JSON.stringify(compactContext(history(14)))
  const cut = a.length - 1 // everything but the closing bracket of the shorter one
  assert.ok(b.startsWith(a.slice(0, cut)))
})
