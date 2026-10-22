// Llama 3.x on Bedrock often prints a tool call as text instead of a Converse
// toolUse block, even when toolConfig was sent. These shapes show up:
//   {"type":"function","name":"shell","parameters":{"command":"date"}}
//   {"name":"shell","parameters":{...}} or "arguments"
//   <|python_tag|>{...}
//   the same JSON inside a markdown fence, with prose around it.

export type LlamaTextToolCall = {
  toolCallId: string
  toolName: string
  input: string
}

export type LlamaTextPart =
  { type: "text"; text: string } | ({ type: "tool-call" } & LlamaTextToolCall)

const PYTHON_TAG = /<\|python_tag\|>\s*$/

export function extractLlamaTextToolCalls(
  text: string,
  toolNames: ReadonlySet<string>,
  idFor: (index: number, name: string) => string = (index, name) =>
    `llama-${index}-${name}`
): LlamaTextPart[] | null {
  if (!text || toolNames.size === 0) return null
  const spans = findToolSpans(text, toolNames)
  if (spans.length === 0) return null
  const parts: LlamaTextPart[] = []
  let cursor = 0
  spans.forEach((span, index) => {
    const prose = text.slice(cursor, span.start).trim()
    if (prose) parts.push({ type: "text", text: prose })
    parts.push({
      type: "tool-call",
      toolCallId: idFor(index, span.name),
      toolName: span.name,
      input: span.input,
    })
    cursor = span.end
  })
  const tail = text.slice(cursor).trim()
  if (tail) parts.push({ type: "text", text: tail })
  return parts
}

type Span = { start: number; end: number; name: string; input: string }

function findToolSpans(text: string, toolNames: ReadonlySet<string>) {
  const spans: Span[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue
    const jsonEnd = balancedEnd(text, i)
    if (jsonEnd < 0) continue
    let value: unknown
    try {
      value = JSON.parse(text.slice(i, jsonEnd))
    } catch {
      continue
    }
    const calls = toolCallsIn(value, toolNames)
    if (!calls) continue
    const span = expandSpan(text, i, jsonEnd)
    if (spans.length > 0 && span.start < spans[spans.length - 1].end) continue
    calls.forEach((call, index) => {
      spans.push({
        start: index === 0 ? span.start : span.end,
        end: span.end,
        name: call.name,
        input: call.input,
      })
    })
    i = span.end - 1
  }
  return spans
}

function toolCallsIn(value: unknown, toolNames: ReadonlySet<string>) {
  if (Array.isArray(value)) {
    const calls = value.map((item) => asToolCall(item, toolNames))
    if (calls.every((call) => call) && calls.length > 0)
      return calls as NonNullable<ReturnType<typeof asToolCall>>[]
    return null
  }
  const call = asToolCall(value, toolNames)
  return call ? [call] : null
}

function asToolCall(value: unknown, toolNames: ReadonlySet<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = record.name
  if (typeof name !== "string" || !toolNames.has(name)) return null
  if (record.type != null && record.type !== "function" && record.type !== "tool_call")
    return null
  const raw = record.parameters ?? record.arguments
  if (raw == null && record.type == null) return null
  const input = argumentsObject(raw)
  if (!input) return null
  return { name, input: JSON.stringify(input) }
}

function argumentsObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return {}
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    } catch {
      return null
    }
    return null
  }
  if (typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>
  return null
}

function expandSpan(text: string, start: number, end: number) {
  let from = start
  let to = end
  const tag = PYTHON_TAG.exec(text.slice(0, from))
  if (tag) from -= tag[0].length
  const fenceOpen = text.lastIndexOf("```", from)
  if (fenceOpen >= 0) {
    const fenceClose = text.indexOf("```", to)
    if (fenceClose >= 0) {
      const between = text.slice(fenceOpen + 3, from)
      const after = text.slice(to, fenceClose)
      if (/^[a-zA-Z0-9_-]*\s*$/.test(between) && /^\s*$/.test(after)) {
        from = fenceOpen
        to = fenceClose + 3
      }
    }
  }
  return { start: from, end: to }
}

function balancedEnd(text: string, start: number) {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escape) escape = false
      else if (char === "\\") escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{" || char === "[") depth++
    else if (char === "}" || char === "]") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

type GenerateLike = {
  content: Array<{
    type: string
    text?: string
    toolCallId?: string
    toolName?: string
    input?: string
  }>
  finishReason?: { unified?: string; raw?: unknown } | string
}

// Rewrites Llama text-form calls into tool-call parts the AI SDK will run.
// Native toolUse blocks already on the result are left alone.
export function liftLlamaTextToolCalls<T extends GenerateLike>(
  result: T,
  toolNames: ReadonlySet<string>
): T {
  if (toolNames.size === 0) return result
  if (result.content.some((part) => part.type === "tool-call")) return result
  let lifted = false
  const content: T["content"] = []
  for (const part of result.content) {
    if (part.type !== "text" || !part.text) {
      content.push(part)
      continue
    }
    const rewritten = extractLlamaTextToolCalls(part.text, toolNames)
    if (!rewritten) {
      content.push(part)
      continue
    }
    lifted = true
    content.push(...rewritten)
  }
  if (!lifted) return result
  const finishReason = result.finishReason
  const nextFinish =
    finishReason && typeof finishReason === "object"
      ? { ...finishReason, unified: "tool-calls" }
      : finishReason
  return { ...result, content, finishReason: nextFinish }
}
