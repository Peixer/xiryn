import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import {
  BedrockClient,
  ListInferenceProfilesCommand,
  type InferenceProfileSummary,
} from "@aws-sdk/client-bedrock"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"

import { getSetting, getSettingSource } from "@/lib/config"
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

export function createBedrockModel(model: string) {
  const explicit = bedrockExplicitCredentials()
  if (explicit && (!explicit.accessKeyId || !explicit.secretAccessKey)) {
    throw new Error(
      "Amazon Bedrock needs both an access key id and a secret, or neither (to use the instance role). Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or clear both."
    )
  }
  const baseUrl = getSetting("provider.bedrock.baseUrl")
  const provider = createAmazonBedrock({
    region: bedrockRegion(),
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(explicit
      ? {
          accessKeyId: explicit.accessKeyId,
          secretAccessKey: explicit.secretAccessKey,
          ...(explicit.sessionToken ? { sessionToken: explicit.sessionToken } : {}),
        }
      : { credentialProvider: fromNodeProviderChain() }),
  })
  return provider(model)
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

// System inference profiles this region can call. EU installs should use the
// eu.* profiles; the curated suggestions are merged in front of the live list.
export async function discoverBedrockModels(): Promise<DiscoveredModel[]> {
  const meta = getProviderMeta("bedrock")
  const client = new BedrockClient({
    region: bedrockRegion(),
    credentials: credentials(),
  })
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
  const live = found
    .filter((profile) => profile.status === "ACTIVE" && profile.inferenceProfileId)
    .filter((profile) => !SKIP.test(profile.inferenceProfileId ?? ""))
    .filter((profile) => !SKIP.test(profile.inferenceProfileName ?? ""))
    .map((profile) => ({
      id: profile.inferenceProfileId as string,
      label: profile.inferenceProfileName,
    }))
  const suggested = (meta?.suggested ?? []).map((id) => ({ id }))
  const seen = new Set<string>()
  const merged: DiscoveredModel[] = []
  for (const model of [...suggested, ...live]) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    merged.push(model)
  }
  return merged
}
