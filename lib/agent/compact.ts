/* ─────────────────────── context compaction ─────────────────────
 * Every step of a tool loop resends the whole conversation. A desktop
 * task can take dozens of steps, each adding a screenshot or a fetched
 * page, so without care the input grows quadratically. Before each step
 * only the newest screenshots stay as images and only the newest tool
 * outputs stay whole; older ones shrink to a short stub.
 *
 * The window moves in chunks, not one result per step. A sliding window
 * rewrites an old result on every step, which changes the prompt prefix
 * and defeats the provider's prompt cache. Moving in chunks keeps the
 * prefix byte-identical for several steps in a row, so the cache can read
 * everything but the newest result. The window stays between KEPT and
 * KEPT + chunk - 1 results long.
 * ────────────────────────────────────────────────────────────────── */

import type { ModelMessage } from "ai"

export const IMAGES_KEPT = 2
export const OUTPUTS_KEPT = 6
const IMAGE_CHUNK = 3
const OUTPUT_CHUNK = 6
const STUB_CHARS = 600

type ToolOutput = { type: string; value?: unknown }

function shrink(output: ToolOutput, keepImage: boolean, keepFull: boolean): ToolOutput {
  if (output.type === "content" && Array.isArray(output.value)) {
    if (keepImage) return output
    const text = (output.value as { type: string; text?: string }[])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
    return { type: "text", value: `${text} [earlier screenshot omitted]`.trim() }
  }
  if (keepFull) return output
  const raw =
    typeof output.value === "string" ? output.value : JSON.stringify(output.value ?? "")
  if (raw.length <= STUB_CHARS) return output
  return {
    type: "text",
    value: `${raw.slice(0, STUB_CHARS)}… [${raw.length - STUB_CHARS} more characters of an earlier result trimmed]`,
  }
}

// How many of the newest `total` results stay whole. With chunk 1 this is the
// plain sliding window; otherwise it only changes every `chunk` results.
function windowSize(total: number, kept: number, chunk: number) {
  return total <= kept ? total : kept + ((total - kept) % chunk)
}

export function compactContext(input: ModelMessage[], chunked = true): ModelMessage[] {
  let imageTotal = 0
  let outputTotal = 0
  for (const message of input) {
    if (message.role !== "tool") continue
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      outputTotal++
      if ((part.output as ToolOutput).type === "content") imageTotal++
    }
  }
  const outputsWhole = windowSize(outputTotal, OUTPUTS_KEPT, chunked ? OUTPUT_CHUNK : 1)
  const imagesWhole = windowSize(imageTotal, IMAGES_KEPT, chunked ? IMAGE_CHUNK : 1)
  let images = 0
  let outputs = 0
  return input
    .slice()
    .reverse()
    .map((message) => {
      if (message.role !== "tool") return message
      const content = message.content
        .slice()
        .reverse()
        .map((part) => {
          if (part.type !== "tool-result") return part
          const output = part.output as ToolOutput
          const isImage = output.type === "content"
          const keepImage = isImage && images < imagesWhole
          const keepFull = outputs < outputsWhole
          if (isImage) images++
          outputs++
          return {
            ...part,
            output: shrink(output, keepImage, keepFull) as typeof part.output,
          }
        })
        .reverse()
      return { ...message, content }
    })
    .reverse()
}
