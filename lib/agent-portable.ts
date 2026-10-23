import { z } from "zod"

import { modelSpecSchema } from "@/db/schema"
import { parseModelSpec } from "@/lib/providers/catalog"

// A shareable copy of an agent's configuration. Version 1 carries only the
// fields that define how an agent behaves: name, role, standing orders, an
// optional model and the glyph seed. Ids, memory, threads, routines, vault
// items, keys, workstation files and spend stay on the machine they belong to.
// Standing orders are prompt text — import shows them and waits for a confirm.

export const PORTABLE_AGENT_VERSION = 1
export const PORTABLE_AGENT_KIND = "xiryn-agent"
export const PORTABLE_AGENT_MAX_BYTES = 256 * 1024

const NAME_MAX = 40

const portableAgentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the agent a name.")
      .max(NAME_MAX, "Keep it under 40 characters."),
    role: z
      .string()
      .trim()
      .min(1, "Describe what the agent is for.")
      .max(120, "Keep it under 120 characters."),
    instructions: z.string().trim().max(6000, "Keep it under 6000 characters.").nullish(),
    model: z.union([modelSpecSchema, z.literal(""), z.null()]).optional(),
    glyph: z.string().trim().min(1).max(64).nullish(),
  })
  .strict()

export const portableAgentFileSchema = z
  .object({
    version: z.literal(PORTABLE_AGENT_VERSION),
    kind: z.literal(PORTABLE_AGENT_KIND),
    agent: portableAgentSchema,
  })
  .strict()

export type PortableAgentFile = z.infer<typeof portableAgentFileSchema>

export type PortableAgentSource = {
  name: string
  role: string
  instructions?: string | null
  model?: string | null
  glyph?: string | null
}

export type PortableAgentErrorCode = "oversize" | "bad-version" | "invalid"

export type ParsePortableAgentResult =
  | { ok: true; file: PortableAgentFile }
  | { ok: false; code: PortableAgentErrorCode; error: string }

// Allowlisted on purpose: anything else on the source is dropped, including
// ids and secrets a caller might pass in from a full agent row.
export function exportAgentDocument<T extends PortableAgentSource>(
  source: T
): PortableAgentFile {
  const agent: PortableAgentFile["agent"] = {
    name: source.name.trim(),
    role: source.role.trim(),
  }
  const instructions = source.instructions?.trim()
  if (instructions) agent.instructions = instructions
  const model = source.model?.trim()
  if (model) agent.model = model
  const glyph = source.glyph?.trim()
  if (glyph) agent.glyph = glyph
  return { version: PORTABLE_AGENT_VERSION, kind: PORTABLE_AGENT_KIND, agent }
}

export function serializePortableAgent(file: PortableAgentFile) {
  return `${JSON.stringify(file, null, 2)}\n`
}

export function agentExportFilename(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${slug || "agent"}.xiryn-agent.json`
}

export function parsePortableAgent(raw: string): ParsePortableAgentResult {
  if (raw.length > PORTABLE_AGENT_MAX_BYTES) {
    return oversize()
  }
  const bytes = new TextEncoder().encode(raw).byteLength
  if (bytes > PORTABLE_AGENT_MAX_BYTES) return oversize()

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, code: "invalid", error: "That isn't valid JSON." }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "invalid", error: "This isn't an agent file." }
  }
  const version = (data as { version?: unknown }).version
  if (version !== PORTABLE_AGENT_VERSION) {
    return {
      ok: false,
      code: "bad-version",
      error: "This Xiryn doesn't know that agent file version.",
    }
  }

  const parsed = portableAgentFileSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const unrecognized = issue?.code === "unrecognized_keys"
    return {
      ok: false,
      code: "invalid",
      error: unrecognized
        ? "This file has fields that are not part of an agent export."
        : (issue?.message ?? "This agent file isn't valid."),
    }
  }
  return { ok: true, file: parsed.data }
}

function oversize(): ParsePortableAgentResult {
  return {
    ok: false,
    code: "oversize",
    error: "That file is larger than 256 KB.",
  }
}

// "Vega" taken → "Vega (2)", then "Vega (3)". The suffix is appended, and the
// base is shortened only so the result still fits the 40-character name limit.
export function uniqueAgentName(name: string, taken: Iterable<string>) {
  const used = new Set(taken)
  const baseName = name.trim()
  if (!used.has(baseName)) return baseName
  for (let n = 2; n < 10_000; n++) {
    const suffix = ` (${n})`
    const room = NAME_MAX - suffix.length
    const base =
      room >= baseName.length ? baseName : baseName.slice(0, Math.max(room, 0)).trimEnd()
    const candidate = `${base}${suffix}`
    if (candidate.length <= NAME_MAX && !used.has(candidate)) return candidate
  }
  throw new Error("Couldn't find a free name.")
}

export type PreparedAgentImport = {
  input: {
    name: string
    role: string
    instructions: string
    model: string
    glyph: string
  }
  renamedFrom: string | null
  modelNotice: string | null
}

// `model: ""` means the workspace default. A model whose provider isn't
// configured here is dropped, and `modelNotice` says what will be used instead.
export function prepareAgentImport(
  file: PortableAgentFile,
  options: {
    takenNames: Iterable<string>
    providerConfigured: (providerId: string) => boolean
    defaultModel: string | null
    glyphFallback: string
  }
): PreparedAgentImport {
  const name = uniqueAgentName(file.agent.name, options.takenNames)
  const requested = file.agent.model?.trim() || ""
  let model = requested
  let modelNotice: string | null = null
  if (requested) {
    const parsed = parseModelSpec(requested)
    const configured = parsed ? options.providerConfigured(parsed.provider) : false
    if (!configured) {
      model = ""
      modelNotice = options.defaultModel
        ? `${requested} isn't configured on this install, so the agent will use the default model (${options.defaultModel}).`
        : `${requested} isn't configured on this install, so the agent will use the workspace default once one is set.`
    }
  }
  return {
    input: {
      name,
      role: file.agent.role,
      instructions: file.agent.instructions?.trim() ?? "",
      model,
      glyph: file.agent.glyph?.trim() || options.glyphFallback,
    },
    renamedFrom: name === file.agent.name ? null : file.agent.name,
    modelNotice,
  }
}
