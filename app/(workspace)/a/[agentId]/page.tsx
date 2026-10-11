import { eq } from "drizzle-orm"
import { notFound, redirect } from "next/navigation"

import { StartThread } from "@/components/thread/start-thread"
import { db } from "@/db"
import { agents } from "@/db/schema"
import { getLatestThreadId } from "@/queries/workspace"

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) notFound()

  const latest = getLatestThreadId({ agentId })
  if (latest) redirect(`/a/${agentId}/${latest}`)

  return (
    <StartThread
      owner={{ agentId }}
      name={agent.name}
      subtitle={agent.role}
      glyphs={[agent.glyph]}
    />
  )
}
