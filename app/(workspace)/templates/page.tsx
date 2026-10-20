import type { Metadata } from "next"

import { TemplateGallery } from "@/components/templates/gallery"
import { agentTemplates, squadTemplates } from "@/lib/templates"

export const metadata: Metadata = { title: "Templates" }

export default function Page() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="label-mono">{`// templates · ${agentTemplates.length} agents · ${squadTemplates.length} squads`}</span>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Ready-made agents with standing orders for common jobs. Pick one to open it in
            the editor: rename it, change its orders or give it its own model before it
            goes online. Each gets its own desktop and memory, like any agent.
          </p>
        </header>
        <TemplateGallery />
      </div>
    </div>
  )
}
