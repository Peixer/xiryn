"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { agentInputSchema, agents, squadMembers, squads, threads } from "@/db/schema"
import { getAgentTemplate, squadTemplates } from "@/lib/templates"

const templateIdSchema = z.string().trim().min(1).max(40)

// Creates a ready-made squad: its agents (reusing any already made from the
// same template), the squad and a first thread. Returns where to go.
export async function createSquadFromTemplate(id: string) {
  const template = squadTemplates.find((t) => t.id === templateIdSchema.parse(id))
  if (!template) throw new Error("Unknown squad template")

  const existing = db.select().from(agents).all()
  const href = db.transaction((tx) => {
    const memberIds = template.members.map((memberId) => {
      const preset = getAgentTemplate(memberId)
      if (!preset) throw new Error(`Unknown agent template: ${memberId}`)
      const match = existing.find(
        (agent) => agent.name === preset.name && agent.role === preset.role
      )
      if (match) return match.id
      const values = agentInputSchema.parse({
        category: preset.agentCategory ?? "general",
        name: preset.name,
        role: preset.role,
        instructions: preset.instructions,
        model: "",
        glyph: preset.glyph,
      })
      const [agent] = tx
        .insert(agents)
        .values({ ...values, model: null })
        .returning({ id: agents.id })
        .all()
      tx.insert(threads).values({ agentId: agent.id }).run()
      return agent.id
    })

    const [squad] = tx.insert(squads).values({ name: template.name }).returning().all()
    tx.insert(squadMembers)
      .values(
        memberIds.map((agentId, position) => ({ squadId: squad.id, agentId, position }))
      )
      .run()
    const [thread] = tx
      .insert(threads)
      .values({ squadId: squad.id })
      .returning({ id: threads.id })
      .all()
    return `/s/${squad.id}/${thread.id}`
  })

  revalidatePath("/", "layout")
  return { href, name: template.name }
}
