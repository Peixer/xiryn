"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  SKILL_DESCRIPTION_MAX,
  SKILL_MAX_BYTES,
  SKILL_NAME_MAX,
  SkillError,
  deleteSkill as deleteSkillFile,
  exportSkillMarkdown,
  exportSkillsBundle,
  importSkillsText,
  writeSkill,
} from "@/lib/skills"

const skillInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(SKILL_NAME_MAX, "Name must be 80 characters or fewer."),
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(SKILL_DESCRIPTION_MAX, "Description must be 1024 characters or fewer."),
  body: z.string().max(SKILL_MAX_BYTES, "A skill must be 16 KB or smaller."),
})

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "That skill path is not allowed.")

function messageOf(error: unknown) {
  if (error instanceof SkillError) return error.message
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join(" ")
  }
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

export async function saveSkill(input: unknown, slug?: string) {
  try {
    const values = skillInputSchema.parse(input)
    const saved = writeSkill(
      { ...values, ...(slug ? { slug: slugSchema.parse(slug) } : {}) },
      { replace: Boolean(slug) }
    )
    revalidatePath("/skills")
    return { ok: true as const, slug: saved.slug }
  } catch (error) {
    return { ok: false as const, error: messageOf(error) }
  }
}

export async function deleteSkill(slug: string) {
  try {
    deleteSkillFile(slugSchema.parse(slug))
    revalidatePath("/skills")
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: messageOf(error) }
  }
}

export async function importSkills(text: string, filename?: string) {
  try {
    const result = importSkillsText(text, {
      filename: filename ? z.string().max(200).parse(filename) : undefined,
    })
    revalidatePath("/skills")
    return { ok: true as const, ...result }
  } catch (error) {
    return { ok: false as const, error: messageOf(error) }
  }
}

export async function exportSkill(slug: string) {
  try {
    const safe = slugSchema.parse(slug)
    return {
      ok: true as const,
      filename: `${safe}.md`,
      content: exportSkillMarkdown(safe),
      mediaType: "text/markdown",
    }
  } catch (error) {
    return { ok: false as const, error: messageOf(error) }
  }
}

export async function exportAllSkills() {
  return {
    ok: true as const,
    filename: "xiryn-skills.json",
    content: exportSkillsBundle(),
    mediaType: "application/json",
  }
}
