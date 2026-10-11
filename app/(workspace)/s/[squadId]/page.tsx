import { notFound, redirect } from "next/navigation"

import { StartThread } from "@/components/thread/start-thread"
import { getLatestThreadId, getSquads } from "@/queries/workspace"

export default async function Page({ params }: { params: Promise<{ squadId: string }> }) {
  const { squadId } = await params
  const squad = getSquads().find((s) => s.id === squadId)
  if (!squad) notFound()

  const latest = getLatestThreadId({ squadId })
  if (latest) redirect(`/s/${squadId}/${latest}`)

  return (
    <StartThread
      owner={{ squadId }}
      name={squad.name}
      subtitle={squad.agents.map((a) => a.name).join(" · ")}
      glyphs={squad.agents.map((a) => a.glyph)}
    />
  )
}
