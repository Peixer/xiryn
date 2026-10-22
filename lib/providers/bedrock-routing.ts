// Pure routing and output-cap rules for Amazon Bedrock. No SDK, no database,
// so the limits can be tested without credentials.

const REGION = /^[a-z]{2}-[a-z]+-\d$/

// What we ask for when a model card does not publish a lower ceiling.
// Claude Sonnet 4.6 accepts this; smaller models are clamped below.
export const BEDROCK_DEFAULT_MAX_OUTPUT = 16_384

// Published ceilings. Nova Pro's Converse error names 10000 exactly.
// Llama 3.3 70B Instruct's model card says "Max output tokens: 4K", which is
// 4096 tokens (https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-meta-llama-3-3-70b-instruct.html).
const MAX_OUTPUT: { test: RegExp; tokens: number }[] = [
  { test: /llama3-3-70b-instruct/, tokens: 4_096 },
  { test: /amazon\.nova-(pro|lite|micro)-v1:0$/, tokens: 10_000 },
]

// Models whose card says tool use and ConverseStream cannot be combined.
// Chat still streams. A step that includes tools uses Converse, then the
// reply is replayed into the chat stream.
const TOOLS_BLOCK_STREAMING = [/llama3-3-70b-instruct/]

// Friendly entries shown when that region is listed in the extra-region
// setting. The region itself is not assumed; nothing here is offered until
// the operator names the region.
export const BEDROCK_REGION_CATALOG: Record<string, { id: string; label: string }[]> = {
  "us-east-2": [
    {
      id: "meta.llama3-3-70b-instruct-v1:0",
      label: "Llama 3.3 70B (Ohio)",
    },
  ],
}

export function parseExtraRegions(value: string | undefined | null) {
  if (!value?.trim()) return []
  const regions: string[] = []
  for (const part of value.split(/[,\s]+/)) {
    const region = part.trim()
    if (!region) continue
    if (!REGION.test(region)) {
      throw new Error(`"${region}" is not an AWS region. Use ids like us-east-2.`)
    }
    if (!regions.includes(region)) regions.push(region)
  }
  return regions
}

// "model-id=region, other-id=region". Model ids contain colons, so the split
// is on the first equals sign of each comma-separated pair.
export function parseModelRegionMap(value: string | undefined | null) {
  const map: Record<string, string> = {}
  if (!value?.trim()) return map
  for (const part of value.split(/[,\n]+/)) {
    const piece = part.trim()
    if (!piece) continue
    const eq = piece.indexOf("=")
    if (eq <= 0 || eq === piece.length - 1) {
      throw new Error(
        `Model regions look like meta.llama3-3-70b-instruct-v1:0=us-east-2. "${piece}" does not.`
      )
    }
    const id = piece.slice(0, eq).trim()
    const region = piece.slice(eq + 1).trim()
    if (!REGION.test(region)) {
      throw new Error(`"${region}" is not an AWS region. Use ids like us-east-2.`)
    }
    map[id] = region
  }
  return map
}

export function parseMaxOutputOverrides(value: string | undefined | null) {
  const map: Record<string, number> = {}
  if (!value?.trim()) return map
  for (const part of value.split(/[,\n]+/)) {
    const piece = part.trim()
    if (!piece) continue
    const eq = piece.indexOf("=")
    const tokens = eq > 0 ? Number(piece.slice(eq + 1).trim()) : NaN
    const id = eq > 0 ? piece.slice(0, eq).trim() : ""
    if (!id || !Number.isInteger(tokens) || tokens < 1 || tokens > 200_000) {
      throw new Error(
        `Output caps look like eu.amazon.nova-pro-v1:0=10000. "${piece}" does not.`
      )
    }
    map[id] = tokens
  }
  return map
}

export function bedrockMaxOutputTokens(
  modelId: string,
  overrides: Record<string, number> = {}
) {
  if (overrides[modelId]) return overrides[modelId]
  for (const row of MAX_OUTPUT) if (row.test.test(modelId)) return row.tokens
  return BEDROCK_DEFAULT_MAX_OUTPUT
}

export function bedrockStreamsWithTools(modelId: string) {
  return !TOOLS_BLOCK_STREAMING.some((test) => test.test(modelId))
}

export function curatedModels(extraRegions: string[]) {
  const models: { id: string; label: string; region: string }[] = []
  for (const region of extraRegions) {
    for (const model of BEDROCK_REGION_CATALOG[region] ?? []) {
      models.push({ ...model, region })
    }
  }
  return models
}

export function resolveBedrockRegion(
  modelId: string,
  options: {
    defaultRegion: string
    extraRegions: string[]
    modelRegions: Record<string, string>
    discovered?: ReadonlyMap<string, string>
  }
) {
  const explicit = options.modelRegions[modelId]
  if (explicit) return explicit
  const curated = curatedModels(options.extraRegions).find(
    (model) => model.id === modelId
  )
  if (curated) return curated.region
  const discovered = options.discovered?.get(modelId)
  if (discovered) return discovered
  return options.defaultRegion
}
