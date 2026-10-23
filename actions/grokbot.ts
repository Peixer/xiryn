"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { agents } from "@/db/schema"
import { parseAllowlist } from "@/lib/agent/untrusted"
import { getSetting } from "@/lib/config"
import { applyGrokbotPlan, GrokbotApplyError } from "@/lib/grokbot-apply"
import { fetchGrokbotShare } from "@/lib/grokbot-fetch"
import {
  GROKBOT_MAX_BYTES,
  GROKBOT_SCHEME_ERROR,
  classifyGrokbotInput,
  parseGrokbotDocument,
  parseGrokbotValue,
  type GrokbotImportPlan,
} from "@/lib/grokbot-import"
import { SKILL_MAX_COUNT, listSkills } from "@/lib/skills"

const inputSchema = z
  .object({
    url: z.string().max(2048).optional(),
    json: z.string().max(GROKBOT_MAX_BYTES).optional(),
  })
  .strict()

type Loaded =
  | {
      ok: true
      plan: GrokbotImportPlan
      sourceHost: string | null
      sourceLabel: string
    }
  | { ok: false; code: string; error: string }

function mapContext() {
  const skills = listSkills()
  return {
    takenNames: db
      .select({ name: agents.name })
      .from(agents)
      .all()
      .map((row) => row.name),
    takenSlugs: skills.skills.map((skill) => skill.slug),
    skillRoom: Math.max(0, SKILL_MAX_COUNT - skills.skills.length),
  }
}

async function load(input: unknown): Promise<Loaded> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: "invalid", error: "Invalid request." }
  }
  const url = parsed.data.url?.trim() ?? ""
  const json = parsed.data.json ?? ""
  if (Boolean(url) === Boolean(json.trim())) {
    return {
      ok: false,
      code: "invalid",
      error: json.trim()
        ? "Paste a share link or the template JSON, not both."
        : "Paste a share link or the template JSON.",
    }
  }
  if (json.trim()) {
    if (new TextEncoder().encode(json).byteLength > GROKBOT_MAX_BYTES) {
      return { ok: false, code: "oversize", error: "That text is larger than 2 MB." }
    }
    const kind = classifyGrokbotInput(json)
    if (kind.kind === "grokbot-scheme") {
      return { ok: false, code: "fetch", error: GROKBOT_SCHEME_ERROR }
    }
    if (kind.kind === "url") return loadUrl(kind.url)
    if (kind.kind === "rejected") return { ok: false, code: "invalid", error: kind.error }
    const result = parseGrokbotDocument(json, mapContext())
    if (!result.ok) return result
    return {
      ok: true,
      plan: result.plan,
      sourceHost: null,
      sourceLabel: "Pasted JSON",
    }
  }
  const kind = classifyGrokbotInput(url)
  if (kind.kind === "grokbot-scheme") {
    return { ok: false, code: "fetch", error: GROKBOT_SCHEME_ERROR }
  }
  if (kind.kind !== "url") {
    return {
      ok: false,
      code: "fetch",
      error: kind.kind === "rejected" ? kind.error : "Paste an https:// share link.",
    }
  }
  return loadUrl(kind.url)
}

async function loadUrl(url: string): Promise<Loaded> {
  const allowHosts = parseAllowlist(getSetting("grokbot.importHosts"))
  const fetched = await fetchGrokbotShare(url, { allowHosts })
  if (!fetched.ok) return fetched
  const result = parseGrokbotValue(fetched.value, mapContext())
  if (!result.ok) return result
  return {
    ok: true,
    plan: result.plan,
    sourceHost: fetched.host,
    sourceLabel: fetched.display,
  }
}

export async function previewGrokbotImport(input: unknown) {
  try {
    return await load(input)
  } catch (error) {
    console.error(
      "[xiryn] grokbot preview failed:",
      error instanceof Error ? error.name : "unknown"
    )
    return { ok: false as const, code: "failed", error: "Couldn't read that template." }
  }
}

export async function applyGrokbotImport(input: unknown) {
  try {
    const loaded = await load(input)
    if (!loaded.ok) return loaded
    const result = applyGrokbotPlan(loaded.plan)
    revalidatePath("/", "layout")
    return { ok: true as const, sourceHost: loaded.sourceHost, ...result }
  } catch (error) {
    console.error(
      "[xiryn] grokbot import failed:",
      error instanceof Error ? error.name : "unknown"
    )
    const expected =
      error instanceof GrokbotApplyError &&
      /skills library|free skill name/.test(error.message)
        ? error.message
        : "Couldn't import that agent."
    return { ok: false as const, code: "failed", error: expected }
  }
}
