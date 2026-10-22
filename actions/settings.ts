"use server"

import { revalidatePath } from "next/cache"

import { isWritableSetting, setSetting } from "@/lib/config"
import {
  parseExtraRegions,
  parseMaxOutputOverrides,
  parseModelRegionMap,
} from "@/lib/providers/bedrock-routing"
import { getProviderMeta, parseModelSpec, type ProviderId } from "@/lib/providers/catalog"
import { discoverModels } from "@/lib/providers/discover"
import { pingFirecrawl } from "@/lib/web"

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
      (key === "workstation.autoStop" || key === "workstation.autoDelete") &&
      value &&
      !/^\d{1,5}$/.test(value.trim())
    ) {
      throw new Error("Minutes must be a whole number.")
    }
    if (key === "workstation.cpus" && value && !/^(\d{1,2})(\.\d)?$/.test(value.trim())) {
      throw new Error("CPUs must be a number, e.g. 2 or 1.5.")
    }
    if (key === "workstation.memory" && value && !/^\d{1,3}$/.test(value.trim())) {
      throw new Error("Memory must be a whole number of GB.")
    }
    if (key === "workstation.phoneLinks" && value && !/^(on|off)$/.test(value.trim())) {
      throw new Error("Phone take-over links are either on or off.")
    }
    if (key === "telegram.notify" && value && !/^(long|all|off)$/.test(value.trim())) {
      throw new Error("Telegram notices are long, all or off.")
    }
    if (key === "notify.desktop" && value && !/^(on|off)$/.test(value.trim())) {
      throw new Error("Desktop notifications are either on or off.")
    }
    if (key === "updates.check" && value && !/^(on|off)$/.test(value.trim())) {
      throw new Error("The update check is either on or off.")
    }
    if (
      key === "usage.monthlyBudget" &&
      value &&
      !/^\d{1,6}(\.\d{1,2})?$/.test(value.trim())
    ) {
      throw new Error("The budget is a dollar amount, e.g. 20 or 7.50.")
    }
    if (key === "agent.maxSteps" && value && !/^\d{1,3}$/.test(value.trim())) {
      throw new Error("Max steps must be a whole number.")
    }
    if (
      key === "provider.bedrock.region" &&
      value &&
      !/^[a-z]{2}-[a-z]+-\d$/.test(value.trim())
    ) {
      throw new Error("The region looks like eu-west-3.")
    }
    if (key === "bedrock.extraRegions" && value) parseExtraRegions(value)
    if (key === "bedrock.modelRegions" && value) parseModelRegionMap(value)
    if (key === "bedrock.maxOutput" && value) parseMaxOutputOverrides(value)
    if (
      (key === "connectors.gmail" || key === "connectors.calendar") &&
      value &&
      !/^(on|off)$/.test(value.trim())
    ) {
      throw new Error("A connector is either on or off.")
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

export async function testIntegration(name: "firecrawl") {
  if (name !== "firecrawl") return { ok: false as const, error: "Unknown integration" }
  try {
    const { detail } = await pingFirecrawl()
    return { ok: true as const, detail }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}
