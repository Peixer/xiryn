import { db } from "@/db"
import { agents } from "@/db/schema"
import { eq, sql } from "drizzle-orm"
import type { AgentCategory } from "./agent-categories"

export {
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type AgentCategory,
} from "./agent-categories"

// Oldest coding agent owns credentials; names never grant access.
// rowid breaks timestamp ties using insertion order.
export function getCodingCredentialOwner(): string | null {
  const owner = db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.category, "coding"))
    .orderBy(agents.createdAt, sql`rowid`)
    .limit(1)
    .get()
  return owner?.id ?? null
}

export function codingAccess(agent: { id: string; category: AgentCategory | string }) {
  if (agent.category !== "coding") return "off"
  return agent.id === getCodingCredentialOwner() ? "rw" : "ro"
}

export function codingVolumeArgs(agent: {
  id: string
  category: AgentCategory | string
}) {
  const access = codingAccess(agent)
  return access === "off"
    ? []
    : [
        "--volume",
        `xiryn-coding-creds:/home/xiryn/.coding-creds:${access}`,
        "--env",
        "XIRYN_CODING_TOOLS=1",
      ]
}
