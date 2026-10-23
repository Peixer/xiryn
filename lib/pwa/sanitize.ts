// What a thread may keep on the device. Tool output, vault fills and anything
// that looks like a credential stay on the server. The regex matches the
// approval card's secret-key rule in lib/mcp/approval-preview.ts.

const SECRET_KEY =
  /token|password|passwd|secret|credential|(^|[_\-.])(api[_\-.]?)?keys?$/i

const HIDDEN_TOOL = /vault|type_secret|secret|approval/i

const BEARER = /Bearer\s+\S+/gi
const KEYISH = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g

export function isSensitiveKey(name: string) {
  return SECRET_KEY.test(name)
}

export function redactText(text: string) {
  return text.replace(BEARER, "Bearer [redacted]").replace(KEYISH, "[redacted]")
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted]"
  if (typeof value === "string") return redactText(value)
  if (typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? "••••" : redactValue(child, depth + 1)
  }
  return out
}

export type StoredMessage = {
  id: string
  role: string
  text: string
}

type LoosePart = {
  type?: unknown
  text?: unknown
  toolName?: unknown
  data?: unknown
}

export function messagesForOfflineStore(
  messages: ReadonlyArray<{ id: string; role: string; parts?: unknown }>
): StoredMessage[] {
  return messages.map((message) => {
    const parts = Array.isArray(message.parts) ? (message.parts as LoosePart[]) : []
    const lines: string[] = []
    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      const type = typeof part.type === "string" ? part.type : ""
      if (type === "text" && typeof part.text === "string") {
        const text = redactText(part.text).trim()
        if (text) lines.push(text)
        continue
      }
      if (type === "data-attachment") {
        const data = part.data as { name?: unknown } | undefined
        const name = typeof data?.name === "string" ? redactText(data.name) : ""
        lines.push(name ? `[file: ${name}]` : "[file]")
        continue
      }
      if (type.startsWith("tool-") || type === "dynamic-tool") {
        const name =
          typeof part.toolName === "string" ? part.toolName : type.replace(/^tool-/, "")
        lines.push(
          HIDDEN_TOOL.test(name) ? `[${name}: hidden on this device]` : `[${name}]`
        )
      }
    }
    return {
      id: message.id,
      role: message.role,
      text: lines.join("\n").slice(0, 20_000),
    }
  })
}
