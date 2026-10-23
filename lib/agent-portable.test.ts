import assert from "node:assert/strict"
import { test } from "node:test"

import {
  PORTABLE_AGENT_MAX_BYTES,
  agentExportFilename,
  exportAgentDocument,
  parsePortableAgent,
  prepareAgentImport,
  serializePortableAgent,
  uniqueAgentName,
} from "./agent-portable"

const sample = {
  name: "Vega",
  role: "Research analyst",
  instructions: "Cite every claim.",
  model: "openai/gpt-6-luna",
  glyph: "glyphseed1",
}

test("round trip keeps configuration and drops ids, secrets and history", () => {
  const source = {
    ...sample,
    id: "id-SECRET-AGENT",
    workstationId: "ws-SECRET",
    createdAt: "2020-01-01",
    updatedAt: "2020-01-02",
    memories: [{ content: "memory-SECRET-NOTE" }],
    vault: [{ secret: "vault-SECRET-ITEM", password: "pass-SECRET" }],
    apiKey: "sk-SECRET-KEY",
    routines: [{ token: "routine-SECRET-TOKEN" }],
    mcp: { headers: { Authorization: "Bearer mcp-SECRET-CRED" } },
    spend: { usd: "spend-SECRET-99" },
    threads: [{ parts: "thread-SECRET-HISTORY" }],
  }
  const file = exportAgentDocument(source)
  const json = serializePortableAgent(file)
  for (const secret of [
    "id-SECRET-AGENT",
    "ws-SECRET",
    "memory-SECRET-NOTE",
    "vault-SECRET-ITEM",
    "pass-SECRET",
    "sk-SECRET-KEY",
    "routine-SECRET-TOKEN",
    "mcp-SECRET-CRED",
    "spend-SECRET-99",
    "thread-SECRET-HISTORY",
  ]) {
    assert.equal(json.includes(secret), false, secret)
  }
  assert.deepEqual(Object.keys(file).sort(), ["agent", "kind", "version"])
  assert.equal(file.version, 1)
  assert.equal(file.kind, "xiryn-agent")
  assert.deepEqual(Object.keys(file.agent).sort(), [
    "glyph",
    "instructions",
    "model",
    "name",
    "role",
  ])

  const parsed = parsePortableAgent(json)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.file, file)

  const prepared = prepareAgentImport(parsed.file, {
    takenNames: [],
    providerConfigured: () => true,
    defaultModel: "anthropic/claude-sonnet-5-5",
    glyphFallback: "fallbackglyph",
  })
  assert.equal(prepared.renamedFrom, null)
  assert.equal(prepared.modelNotice, null)
  assert.deepEqual(prepared.input, {
    name: sample.name,
    role: sample.role,
    instructions: sample.instructions,
    model: sample.model,
    glyph: sample.glyph,
  })
})

test("export omits an empty model and blank instructions", () => {
  const file = exportAgentDocument({
    name: "Mira",
    role: "Assistant",
    instructions: "   ",
    model: null,
    glyph: "abc",
  })
  assert.deepEqual(file.agent, { name: "Mira", role: "Assistant", glyph: "abc" })
  assert.equal(serializePortableAgent(file).includes("model"), false)
})

test("download name is a slug plus the agent extension", () => {
  assert.equal(agentExportFilename("Vega"), "vega.xiryn-agent.json")
  assert.equal(agentExportFilename("  Research Bot!! "), "research-bot.xiryn-agent.json")
  assert.equal(agentExportFilename("***"), "agent.xiryn-agent.json")
})

test("files over 256 KB are rejected", () => {
  const result = parsePortableAgent(" ".repeat(PORTABLE_AGENT_MAX_BYTES + 1))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, "oversize")
})

test("a file at the 256 KB cap is not rejected for size", () => {
  const json = serializePortableAgent(exportAgentDocument(sample))
  const bytes = new TextEncoder().encode(json).length
  const padded = json + " ".repeat(PORTABLE_AGENT_MAX_BYTES - bytes)
  assert.equal(new TextEncoder().encode(padded).length, PORTABLE_AGENT_MAX_BYTES)
  const result = parsePortableAgent(padded)
  assert.equal(result.ok, true)
})

test("an unknown version is rejected", () => {
  const result = parsePortableAgent(
    JSON.stringify({
      version: 2,
      kind: "xiryn-agent",
      agent: { name: "A", role: "B" },
    })
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, "bad-version")
})

test("a missing or non-numeric version is rejected", () => {
  for (const version of [undefined, "1", 0]) {
    const result = parsePortableAgent(
      JSON.stringify({
        version,
        kind: "xiryn-agent",
        agent: { name: "A", role: "B" },
      })
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, "bad-version")
  }
})

test("a name clash appends (2), then (3), without passing 40 characters", () => {
  assert.equal(uniqueAgentName("Vega", ["Atlas"]), "Vega")
  assert.equal(uniqueAgentName("Vega", ["Vega"]), "Vega (2)")
  assert.equal(uniqueAgentName("Vega", ["Vega", "Vega (2)"]), "Vega (3)")
  assert.equal(uniqueAgentName("Vega (2)", ["Vega (2)"]), "Vega (2) (2)")
  const long = "A".repeat(40)
  const next = uniqueAgentName(long, [long])
  assert.ok(next.length <= 40)
  assert.match(next, / \(2\)$/)
  assert.notEqual(next, long)
})

test("instructions longer than 6000 characters are rejected", () => {
  const result = parsePortableAgent(
    JSON.stringify({
      version: 1,
      kind: "xiryn-agent",
      agent: { name: "A", role: "B", instructions: "x".repeat(6001) },
    })
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /6000/)
})

test("instructions of exactly 6000 characters are kept", () => {
  const instructions = "y".repeat(6000)
  const result = parsePortableAgent(
    JSON.stringify({
      version: 1,
      kind: "xiryn-agent",
      agent: { name: "A", role: "B", instructions },
    })
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.file.agent.instructions, instructions)
})

test("an unconfigured model with no workspace default still imports without one", () => {
  const prepared = prepareAgentImport(exportAgentDocument(sample), {
    takenNames: [],
    providerConfigured: () => false,
    defaultModel: null,
    glyphFallback: "fallbackglyph",
  })
  assert.equal(prepared.input.model, "")
  assert.match(prepared.modelNotice ?? "", /workspace default/)
  assert.equal(prepared.modelNotice?.includes("sk-"), false)
})

test("an unconfigured model is dropped and the default is named", () => {
  const prepared = prepareAgentImport(exportAgentDocument(sample), {
    takenNames: ["Vega"],
    providerConfigured: (id) => id === "anthropic",
    defaultModel: "anthropic/claude-sonnet-5-5",
    glyphFallback: "fallbackglyph",
  })
  assert.equal(prepared.input.name, "Vega (2)")
  assert.equal(prepared.renamedFrom, "Vega")
  assert.equal(prepared.input.model, "")
  assert.match(prepared.modelNotice ?? "", /openai\/gpt-6-luna/)
  assert.match(prepared.modelNotice ?? "", /anthropic\/claude-sonnet-5-5/)
  assert.equal(prepared.input.instructions, sample.instructions)
})

test("a configured model is kept and a missing glyph uses the fallback", () => {
  const parsed = parsePortableAgent(
    JSON.stringify({
      version: 1,
      kind: "xiryn-agent",
      agent: { name: "Nova", role: "Writer", model: "anthropic/claude-sonnet-5-5" },
    })
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const prepared = prepareAgentImport(parsed.file, {
    takenNames: [],
    providerConfigured: (id) => id === "anthropic",
    defaultModel: "openai/gpt-6-luna",
    glyphFallback: "fallbackglyph",
  })
  assert.equal(prepared.modelNotice, null)
  assert.equal(prepared.input.model, "anthropic/claude-sonnet-5-5")
  assert.equal(prepared.input.glyph, "fallbackglyph")
  assert.equal(prepared.input.instructions, "")
})

test("extra fields are rejected", () => {
  const result = parsePortableAgent(
    JSON.stringify({
      version: 1,
      kind: "xiryn-agent",
      id: "id-SECRET-AGENT",
      agent: { name: "A", role: "B", apiKey: "sk-SECRET-KEY" },
    })
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, "invalid")
  assert.equal(JSON.stringify(result).includes("sk-SECRET-KEY"), false)
})

test("invalid JSON is rejected", () => {
  const result = parsePortableAgent("{")
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, "invalid")
})
