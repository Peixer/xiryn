"use server"

import { revalidatePath } from "next/cache"

import { getSettingSource, setSetting } from "@/lib/config"
import {
  agentContext,
  bestModelForThisMachine,
  ensureContext,
  memoryGb,
  OLLAMA_MODEL,
  ollamaBinary,
  ollamaRoot,
  ollamaStatus,
  pullModel,
  pullStates,
  recommendedModels,
  startOllama,
} from "@/lib/ollama"

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function checkName(model: string) {
  const name = model.trim()
  if (!OLLAMA_MODEL.test(name)) throw new Error(`"${model}" isn't an Ollama model name.`)
  return name
}

// Points Xiryn at Ollama, unless .env or Settings already do
function connect() {
  const source = getSettingSource("provider.ollama.baseUrl")
  if (source !== "local" && source !== "env") {
    setSetting("provider.ollama.baseUrl", `${ollamaRoot()}/v1`)
  }
}

export async function localModelsPanel() {
  const status = await ollamaStatus()
  const source = getSettingSource("provider.ollama.baseUrl")
  return {
    ...status,
    installed: status.running || ollamaBinary() !== null,
    connected: source === "local" || source === "env",
    memoryGb: memoryGb(),
    context: agentContext(),
    best: bestModelForThisMachine(),
    recommended: recommendedModels,
    pulls: pullStates(),
  }
}

export type LocalModelsPanel = Awaited<ReturnType<typeof localModelsPanel>>

export async function startLocalModels() {
  try {
    await startOllama()
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

// Starts a download and returns right away; progress comes from
// localModelsPanel()
export async function downloadLocalModel(model: string) {
  pullModel(checkName(model))
  connect()
  return localModelsPanel()
}

// Makes a downloaded model the default for every agent without its own
export async function chooseLocalModel(model: string) {
  const name = checkName(model)
  await ensureContext(name)
  connect()
  setSetting("model.default", `ollama/${name}`)
  revalidatePath("/", "layout")
}

// Saves a context large enough for agents on a model downloaded elsewhere
export async function fixLocalModelContext(model: string) {
  await ensureContext(checkName(model))
}

export async function connectLocalModels() {
  connect()
  revalidatePath("/", "layout")
}
