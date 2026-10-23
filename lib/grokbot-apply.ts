import { db } from "@/db"
import { agents, memories, routines, threads } from "@/db/schema"
import { uniqueAgentName } from "@/lib/agent-portable"
import {
  formatImportedMemory,
  grokbotSlug,
  importedMemoryDate,
  type GrokbotImportPlan,
} from "@/lib/grokbot-import"
import { SKILL_MAX_COUNT, deleteSkill, listSkills, writeSkill } from "@/lib/skills"

// Writes one import. Skills live on disk, so a database failure deletes the
// skill files this call created. The database writes themselves are one
// transaction: an agent, its thread, its memories and its routines, or nothing.

export type GrokbotApplyResult = {
  agent: { id: string; name: string }
  threadId: string
  renamedFrom: string | null
  skills: { slug: string; name: string; renamedFrom: string | null }[]
  memories: number
  routines: number
  connectors: GrokbotImportPlan["connectors"]
  onboardingSkill: string | null
  warnings: string[]
}

function freeSlug(base: string, taken: Set<string>) {
  if (!taken.has(base)) return { slug: base, renamedFrom: null as string | null }
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/g, "")}${suffix}`
    if (!taken.has(candidate)) return { slug: candidate, renamedFrom: base }
  }
  throw new GrokbotApplyError("Couldn't find a free skill name.")
}

export class GrokbotApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GrokbotApplyError"
  }
}

export function applyGrokbotPlan(
  plan: GrokbotImportPlan,
  options?: { skillsRoot?: string; beforeCommit?: () => void }
): GrokbotApplyResult {
  const root = options?.skillsRoot
  const existing = listSkills(root ? { root } : undefined)
  const takenSlugs = new Set(existing.skills.map((skill) => skill.slug))
  if (existing.skills.length + plan.skills.length > SKILL_MAX_COUNT) {
    throw new GrokbotApplyError(
      `The skills library already has ${existing.skills.length} skills. This import needs ${plan.skills.length} more, and the library holds ${SKILL_MAX_COUNT}.`
    )
  }

  const written: string[] = []
  const savedSkills: GrokbotApplyResult["skills"] = []
  try {
    for (const skill of plan.skills) {
      const slug = grokbotSlug(skill.slug) ?? skill.slug
      const free = freeSlug(slug, takenSlugs)
      const finalSlug = free.slug
      const renamedFrom = free.renamedFrom ?? skill.renamedFrom
      writeSkill(
        {
          name: skill.name,
          description: skill.description,
          body: skill.body,
          slug: finalSlug,
          source: "grokbot-import",
        },
        { ...(root && { root }), replace: false }
      )
      takenSlugs.add(finalSlug)
      written.push(finalSlug)
      savedSkills.push({ slug: finalSlug, name: skill.name, renamedFrom })
    }

    const names = db
      .select({ name: agents.name })
      .from(agents)
      .all()
      .map((row) => row.name)
    const name = uniqueAgentName(plan.agent.name, names)
    const renamedFrom =
      name === plan.agent.name ? plan.agent.renamedFrom : plan.agent.name

    const created = db.transaction((tx) => {
      const [agent] = tx
        .insert(agents)
        .values({
          name,
          role: plan.agent.role,
          instructions: plan.agent.instructions.trim() || null,
          model: null,
        })
        .returning()
        .all()
      const [thread] = tx
        .insert(threads)
        .values({ agentId: agent.id, title: agent.name })
        .returning({ id: threads.id })
        .all()
      for (const memory of plan.memories) {
        const createdAt = memory.createdAt ? importedMemoryDate(memory.createdAt) : null
        tx.insert(memories)
          .values({
            agentId: agent.id,
            content: formatImportedMemory(memory.kind, memory.content),
            ...(createdAt && { createdAt }),
          })
          .run()
      }
      for (const routine of plan.routines) {
        tx.insert(routines)
          .values({
            name: routine.name,
            agentId: agent.id,
            prompt: routine.prompt,
            schedule: routine.schedule,
            enabled: false,
            nextRunAt: null,
          })
          .run()
      }
      options?.beforeCommit?.()
      return { agent, threadId: thread.id }
    })

    const warnings = [...plan.warnings]
    if (
      renamedFrom &&
      renamedFrom !== name &&
      !warnings.some((warning) => warning.includes(name))
    ) {
      warnings.push(
        `An agent named ${renamedFrom} is already here, so this one is ${name}.`
      )
    }
    for (const skill of savedSkills) {
      if (skill.renamedFrom && skill.slug !== skill.renamedFrom) {
        const line = `A skill named ${skill.renamedFrom} already exists and was not overwritten. This one will be ${skill.slug}.`
        if (!warnings.includes(line)) warnings.push(line)
      }
    }

    return {
      agent: { id: created.agent.id, name: created.agent.name },
      threadId: created.threadId,
      renamedFrom: name === plan.agent.name ? plan.agent.renamedFrom : plan.agent.name,
      skills: savedSkills,
      memories: plan.memories.length,
      routines: plan.routines.length,
      connectors: plan.connectors,
      onboardingSkill: plan.onboardingSkill,
      warnings,
    }
  } catch (error) {
    for (const slug of written) {
      try {
        deleteSkill(slug, root ? { root } : undefined)
      } catch {
        // The skill file may already be gone. The database transaction rolled back.
      }
    }
    if (error instanceof GrokbotApplyError) throw error
    const message = error instanceof Error ? error.message : "Couldn't import that agent."
    throw new GrokbotApplyError(message)
  }
}
