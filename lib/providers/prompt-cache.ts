import { wrapLanguageModel, type LanguageModel } from "ai"

import { getSetting } from "@/lib/config"

// Bedrock prompt caching. A tool loop resends the same system prompt, tool
// list and history on every step; with a cache checkpoint the model's input
// for that unchanged prefix is read back from the cache at a tenth of the
// price. The cache lives inside Bedrock, in the same AWS account and region
// as the call itself, so no data goes anywhere new.
//
// Checkpoints go after the system prompt (which also covers the tool list,
// since tools come first in the prompt) and after the last message. Each step
// writes a new last checkpoint and finds the previous one by looking back.
// On by default for the Bedrock models that support it. Set
// XIRYN_PROMPT_CACHE=off to turn it off.

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

export function withPromptCache(model: LanguageModel, provider: string, modelId: string) {
  if (provider !== "bedrock" || !supportsCachePoints(modelId) || !cacheEnabled())
    return model
  return wrapWithPromptCache(model)
}
