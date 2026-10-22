import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type InferenceProfileSummary,
} from "@aws-sdk/client-bedrock"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { simulateStreamingMiddleware, wrapLanguageModel } from "ai"

import { getSetting, getSettingSource } from "@/lib/config"
import {
  bedrockStreamsWithTools,
  curatedModels,
  parseExtraRegions,
  parseMaxOutputOverrides,
  parseModelRegionMap,
  resolveBedrockRegion,
} from "@/lib/providers/bedrock-routing"
import { liftLlamaTextToolCalls } from "@/lib/providers/llama-tool-text"
import { getProviderMeta } from "@/lib/providers/catalog"

type DiscoveredModel = { id: string; label?: string }

// Amazon Bedrock. Credentials follow the AWS SDK default chain (an EC2
// instance role, a profile, web identity, container credentials) unless an
// access key and secret are saved. The region falls back to eu-west-3, but
// that fallback alone does not mark the provider configured — otherwise every
// install would suddenly prefer a Bedrock model.

export function bedrockRegion() {
  return getSetting("provider.bedrock.region") || "eu-west-3"
}

export function bedrockExplicitCredentials() {
  const accessKeyId = getSetting("provider.bedrock.accessKeyId")
  const secretAccessKey = getSetting("provider.bedrock.secretAccessKey")
  const sessionToken = getSetting("provider.bedrock.sessionToken")
  if (!accessKeyId && !secretAccessKey && !sessionToken) return null
  return { accessKeyId, secretAccessKey, sessionToken }
}

// Signals that the process already has a credential chain besides IMDS.
// An instance role has none of these; the deploy unit opts in with AWS_REGION.
export function bedrockAmbientChain() {
  return Boolean(
    process.env.AWS_PROFILE ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE
  )
}

export function isBedrockConfigured() {
  const explicit = bedrockExplicitCredentials()
  if (explicit?.accessKeyId && explicit.secretAccessKey) return true
  const regionSource = getSettingSource("provider.bedrock.region")
  if (regionSource === "env" || regionSource === "local") return true
  return bedrockAmbientChain()
}

export function bedrockExtraRegions() {
  return parseExtraRegions(getSetting("bedrock.extraRegions"))
}

export function bedrockModelRegions() {
  return parseModelRegionMap(getSetting("bedrock.modelRegions"))
}

export function bedrockMaxOutputOverrides() {
  return parseMaxOutputOverrides(getSetting("bedrock.maxOutput"))
}

// Model ids seen outside the default region. Filled when the picker lists
// models, so a later turn calls the same region without another lookup.
const discoveredRegions = new Map<string, string>()

export function rememberBedrockModelRegion(modelId: string, region: string) {
  const home = bedrockRegion()
  if (region === home) {
    discoveredRegions.set(modelId, home)
    return
  }
  if (discoveredRegions.get(modelId) === home) return
  if (!discoveredRegions.has(modelId)) discoveredRegions.set(modelId, region)
}

export function bedrockRegionFor(modelId: string) {
  return resolveBedrockRegion(modelId, {
    defaultRegion: bedrockRegion(),
    extraRegions: bedrockExtraRegions(),
    modelRegions: bedrockModelRegions(),
    discovered: discoveredRegions,
  })
}

export function createBedrockModel(model: string) {
  const explicit = bedrockExplicitCredentials()
  if (explicit && (!explicit.accessKeyId || !explicit.secretAccessKey)) {
    throw new Error(
      "Amazon Bedrock needs both an access key id and a secret, or neither (to use the instance role). Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or clear both."
    )
  }
  const region = bedrockRegionFor(model)
  const baseUrl = getSetting("provider.bedrock.baseUrl")
  // A VPC endpoint belongs to one region. Other regions use the public one.
  const baseURL = baseUrl && region === bedrockRegion() ? baseUrl : undefined
  const provider = createAmazonBedrock({
    region,
    ...(baseURL ? { baseURL } : {}),
    ...(explicit
      ? {
          accessKeyId: explicit.accessKeyId,
          secretAccessKey: explicit.secretAccessKey,
          ...(explicit.sessionToken ? { sessionToken: explicit.sessionToken } : {}),
        }
      : { credentialProvider: fromNodeProviderChain() }),
  })
  const languageModel = provider(model)
  // Llama 3.3 rejects ConverseStream once tools are attached. A step with
  // tools uses Converse (which sends toolConfig and parses toolUse blocks).
  // If the model still prints the call as text, that text becomes a real
  // tool call so the agent loop runs it.
  if (bedrockStreamsWithTools(model)) return languageModel
  const simulate = simulateStreamingMiddleware()
  return wrapLanguageModel({
    model: languageModel,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) =>
        liftLlamaTextToolCalls(await doGenerate(), namesOf(params.tools)),
      wrapStream: async (options) => {
        if (!options.params.tools?.length || !simulate.wrapStream)
          return options.doStream()
        return simulate.wrapStream({
          ...options,
          doGenerate: async () =>
            liftLlamaTextToolCalls(
              await options.doGenerate(),
              namesOf(options.params.tools)
            ),
        })
      },
    },
  })
}

function namesOf(tools: ReadonlyArray<{ type?: string; name?: string }> | undefined) {
  const names = new Set<string>()
  for (const tool of tools ?? []) {
    if ((tool.type === "function" || tool.type == null) && tool.name) names.add(tool.name)
  }
  return names
}

const SKIP =
  /(embed|image|video|rerank|speech|audio|canvas|reel|sonic|titan-embed|stable-image)/i

function credentials() {
  const explicit = bedrockExplicitCredentials()
  if (explicit?.accessKeyId && explicit.secretAccessKey) {
    return {
      accessKeyId: explicit.accessKeyId,
      secretAccessKey: explicit.secretAccessKey,
      ...(explicit.sessionToken ? { sessionToken: explicit.sessionToken } : {}),
    }
  }
  return fromNodeProviderChain()
}

async function listProfiles(region: string) {
  const client = new BedrockClient({ region, credentials: credentials() })
  const found: InferenceProfileSummary[] = []
  let nextToken: string | undefined
  for (let page = 0; page < 10; page++) {
    const response = await client.send(
      new ListInferenceProfilesCommand({
        typeEquals: "SYSTEM_DEFINED",
        maxResults: 100,
        nextToken,
      })
    )
    found.push(...(response.inferenceProfileSummaries ?? []))
    nextToken = response.nextToken
    if (!nextToken) break
  }
  return found
    .filter((profile) => profile.status === "ACTIVE" && profile.inferenceProfileId)
    .filter((profile) => !SKIP.test(profile.inferenceProfileId ?? ""))
    .filter((profile) => !SKIP.test(profile.inferenceProfileName ?? ""))
    .map((profile) => ({
      id: profile.inferenceProfileId as string,
      label: profile.inferenceProfileName,
    }))
}

async function listOnDemand(region: string) {
  const client = new BedrockClient({ region, credentials: credentials() })
  const response = await client.send(
    new ListFoundationModelsCommand({ byOutputModality: "TEXT" })
  )
  return (response.modelSummaries ?? [])
    .filter(
      (model) => model.modelId && model.inferenceTypesSupported?.includes("ON_DEMAND")
    )
    .filter((model) => model.outputModalities?.includes("TEXT"))
    .filter((model) => !SKIP.test(model.modelId ?? ""))
    .filter((model) => !SKIP.test(model.modelName ?? ""))
    .map((model) => ({
      id: model.modelId as string,
      label: model.modelName,
    }))
}

// Profiles in the default region, plus on-demand models and profiles from
// each extra region. An id that does not exist in the default region is
// remembered so later calls use the region it was listed in.
export async function discoverBedrockModels(): Promise<DiscoveredModel[]> {
  const meta = getProviderMeta("bedrock")
  const home = bedrockRegion()
  const extras = bedrockExtraRegions()
  const homeModels = await listProfiles(home)
  for (const model of homeModels) rememberBedrockModelRegion(model.id, home)

  const extraModels: DiscoveredModel[] = []
  for (const region of extras) {
    try {
      const [profiles, onDemand] = await Promise.all([
        listProfiles(region),
        listOnDemand(region),
      ])
      for (const model of [...onDemand, ...profiles]) {
        rememberBedrockModelRegion(model.id, region)
        if (bedrockRegionFor(model.id) === home) continue
        extraModels.push({
          id: model.id,
          label: model.label ? `${model.label} (${region})` : region,
        })
      }
    } catch (error) {
      console.error(`[xiryn] bedrock list ${region}:`, error)
    }
  }

  const curated = curatedModels(extras).map((model) => ({
    id: model.id,
    label: model.label,
  }))
  const suggested: DiscoveredModel[] = (meta?.suggested ?? []).map((id) => ({ id }))
  const seen = new Set<string>()
  const merged: DiscoveredModel[] = []
  for (const model of [...curated, ...suggested, ...homeModels, ...extraModels]) {
    if (seen.has(model.id)) {
      const existing = merged.find((item) => item.id === model.id)
      if (existing && !existing.label && model.label) existing.label = model.label
      continue
    }
    seen.add(model.id)
    merged.push({ ...model })
  }
  return merged
}
