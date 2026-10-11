"use server"

import { revalidatePath } from "next/cache"

import { isWritableSetting, setSetting } from "@/lib/config"
import { getProviderMeta, parseModelSpec, type ProviderId } from "@/lib/providers/catalog"
import { discoverModels } from "@/lib/providers/discover"
import { pingFirecrawl } from "@/lib/web"
import { pingDaytona } from "@/lib/workstation"

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// Values are only ever written here and read on the server; the browser
// only ever sees masked versions of secrets
export async function saveSettings(values: Record<string, string | null>) {
  for (const [key, value] of Object.entries(values)) {
    if (!isWritableSetting(key)) throw new Error(`Unknown setting: ${key}`)
    if (key === "model.default" && value && !parseModelSpec(value.trim())) {
      throw new Error(
        "The default model must look like provider/model, e.g. openai/gpt-6-luna."
      )
    }
    if (
      (key === "daytona.autoStop" || key === "daytona.autoDelete") &&
      value &&
      !/^\d{1,5}$/.test(value.trim())
    ) {
      throw new Error("Minutes must be a whole number.")
    }
    if (key === "agent.maxSteps" && value && !/^\d{1,3}$/.test(value.trim())) {
      throw new Error("Max steps must be a whole number.")
    }
    setSetting(key, value)
  }
  revalidatePath("/", "layout")
}

export async function fetchProviderModels(provider: ProviderId) {
  if (!getProviderMeta(provider)) return { ok: false as const, error: "Unknown provider" }
  try {
    return { ok: true as const, models: await discoverModels(provider) }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

export async function testIntegration(name: "daytona" | "firecrawl") {
  try {
    if (name === "daytona") {
      const { sandboxes } = await pingDaytona()
      return {
        ok: true as const,
        detail: `Connected · ${sandboxes} Oryn workstation${sandboxes === 1 ? "" : "s"}`,
      }
    }
    const { remainingCredits, planCredits } = await pingFirecrawl()
    const credits =
      remainingCredits === null
        ? ""
        : ` · ${remainingCredits.toLocaleString()}${planCredits ? ` / ${planCredits.toLocaleString()}` : ""} credits left`
    return { ok: true as const, detail: `Connected${credits}` }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}
