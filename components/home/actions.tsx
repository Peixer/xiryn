"use client"

import { PlusIcon, UsersIcon } from "lucide-react"

import { agentTemplates, useWorkspace } from "@/components/workspace/context"
import { Glyph } from "@/components/glyph"

export function NewAgentCard() {
  const { openAgentDialog } = useWorkspace()
  return (
    <button
      type="button"
      onClick={() => openAgentDialog()}
      className="group flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-input hover:bg-surface/60 hover:text-foreground"
    >
      <span className="grid size-8 place-items-center rounded-lg border bg-background transition-transform group-hover:scale-105">
        <PlusIcon className="size-4" />
      </span>
      <span className="text-[13px] font-medium">New agent</span>
    </button>
  )
}

export function NewSquadButton({ disabled }: { disabled?: boolean }) {
  const { openSquadDialog } = useWorkspace()
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => openSquadDialog()}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      <UsersIcon className="size-3.5" />
      New squad
    </button>
  )
}

// Seeds chosen so each template shows a distinct sky
const templateSeeds = ["vega-1", "rigel-7", "lyra-3", "atlas-5"]

export function TemplateGrid() {
  const { openAgentDialog } = useWorkspace()
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {agentTemplates.map((template, i) => (
        <button
          key={template.name}
          type="button"
          onClick={() => openAgentDialog({ template })}
          className="group flex flex-col gap-3 rounded-xl border bg-surface/50 p-4 text-left transition-colors hover:border-input hover:bg-surface"
        >
          <div className="flex items-center gap-2.5">
            <Glyph seed={templateSeeds[i]} className="size-9" />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-[14px] font-semibold">{template.name}</span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                {template.role}
              </span>
            </div>
          </div>
          <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {template.instructions}
          </p>
          <span className="mt-auto font-mono text-[11px] text-rigel opacity-70 transition-opacity group-hover:opacity-100">
            deploy →
          </span>
        </button>
      ))}
    </div>
  )
}
