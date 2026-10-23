import { wrapLanguageModel, type LanguageModel } from "ai"

import { getSetting } from "@/lib/config"

// Prompt caching for providers that do not do it on their own.
//
// Bedrock: a tool loop resends the same system prompt, tool list and history
// on every step; with a cache checkpoint the model's input for that unchanged
// prefix is read back from the cache at a tenth of the price. The cache lives
// inside Bedrock, in the same AWS account and region as the call itself, so
// no data goes anywhere new. Checkpoints go after the system prompt (which
// also covers the tool list, since tools come first in the prompt) and after
// the last message. Each step writes a new last checkpoint and finds the
// previous one by looking back.
//
// OpenRouter Claude: OpenRouter's automatic cache is one top-level
// `cache_control: { type: "ephemeral" }` on the chat request. The breakpoint
// moves to the end of the prompt as the conversation grows. The
// OpenAI-compatible client copies unknown keys from `providerOptions.openrouter`
// onto that body (its provider id is "openrouter.chat", so the options name
// is "openrouter"). Other OpenRouter models cache without a marker.
//
// On by default. Set XIRYN_PROMPT_CACHE=off to turn both off.

const CHECKPOINT = { bedrock: { cachePoint: { type: "default" } } }

type Message = { role?: string; providerOptions?: Record<string, unknown> }

export function cacheEnabled() {
  const value = (getSetting("cache.prompt") ?? "").trim().toLowerCase()
  return !["off", "0", "false", "no"].includes(value)
}

// Which Bedrock model ids accept cache checkpoints on the Converse API
export function supportsCachePoints(modelId: string) {
  return /(^|\.)anthropic\.claude-|(^|\.)amazon\.nova-(pro|lite|micro|premier)/.test(
    modelId
  )
}

// OpenRouter model ids are "maker/model". Only Claude needs an explicit marker.
export function supportsOpenRouterClaudeCache(modelId: string) {
  return modelId.startsWith("anthropic/")
}

const EPHEMERAL = { type: "ephemeral" }

// Adds the top-level field the OpenAI-compatible client forwards. An existing
// cache_control (for example a 1-hour ttl) is left as the caller set it.
export function addOpenRouterCacheControl(
  providerOptions: Record<string, unknown> | undefined
) {
  const current = providerOptions?.openrouter
  const openrouter: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {}
  if (openrouter.cache_control == null) openrouter.cache_control = { ...EPHEMERAL }
  return { ...providerOptions, openrouter }
}

function mark<T extends Message>(message: T): T {
  return {
    ...message,
    providerOptions: { ...message.providerOptions, ...CHECKPOINT },
  }
}

export function addCheckpoints<T extends Message>(prompt: T[]): T[] {
  if (prompt.length === 0) return prompt
  const lastSystem = prompt.map((m) => m.role).lastIndexOf("system")
  const last = prompt.length - 1
  return prompt.map((message, index) =>
    index === last || (index === lastSystem && lastSystem < last)
      ? mark(message)
      : message
  )
}

export function wrapWithPromptCache(model: LanguageModel): LanguageModel {
  if (typeof model === "string") return model
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        prompt: addCheckpoints(params.prompt as Message[]) as typeof params.prompt,
      }),
    },
  })
}

function wrapWithOpenRouterCache(model: LanguageModel): LanguageModel {
  if (typeof model === "string") return model
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        // cache_control is JSON. The provider-options map is typed as JSON
        // objects, which this spread does not satisfy on its own.
        providerOptions: addOpenRouterCacheControl(
          params.providerOptions as Record<string, unknown> | undefined
        ) as unknown as typeof params.providerOptions,
      }),
    },
  })
}

export function withPromptCache(model: LanguageModel, provider: string, modelId: string) {
  if (!cacheEnabled()) return model
  if (provider === "bedrock" && supportsCachePoints(modelId))
    return wrapWithPromptCache(model)
  if (provider === "openrouter" && supportsOpenRouterClaudeCache(modelId))
    return wrapWithOpenRouterCache(model)
  return model
}
