import type { Metadata } from "next"

import { AgentsView } from "@/components/agents/agents-view"
import { getAgentOverview } from "@/queries/workspace"

export const metadata: Metadata = { title: "Agents" }

// Reads live state (who's working, counts), so never prerender it
export const dynamic = "force-dynamic"

export default function Page() {
  const agents = getAgentOverview()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="label-mono">{`// agents · ${agents.length}`}</span>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Everyone you&apos;ve created, with the model they run on, the state of their
            workstation and what they&apos;ve accumulated. From here you can open, edit,
            stop or reset an agent&apos;s machine, and delete agents you no longer need.
          </p>
        </header>
        <AgentsView agents={agents} />
      </div>
    </div>
  )
}
