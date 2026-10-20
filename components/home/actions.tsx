"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PlusIcon, SparklesIcon, UsersIcon } from "lucide-react"

import { createSquadFromTemplate } from "@/actions/templates"
import { Glyph } from "@/components/glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { agentTemplates, useWorkspace } from "@/components/workspace/context"

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

export function TemplateGrid({ ids }: { ids?: string[] }) {
  const { openAgentDialog } = useWorkspace()
  const shown = ids
    ? ids.flatMap((id) => agentTemplates.filter((template) => template.id === id))
    : agentTemplates
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {shown.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => openAgentDialog({ template })}
          className="group flex flex-col gap-3 rounded-xl border bg-surface/50 p-4 text-left transition-colors hover:border-input hover:bg-surface"
        >
          <div className="flex items-center gap-2.5">
            <Glyph seed={template.glyph} className="size-9" />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-[14px] font-semibold">{template.name}</span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                {template.role}
              </span>
            </div>
          </div>
          <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {template.blurb}
          </p>
          <span className="mt-auto font-mono text-[11px] text-rigel opacity-70 transition-opacity group-hover:opacity-100">
            deploy →
          </span>
        </button>
      ))}
    </div>
  )
}

// One click to a working team: four agents and a squad to talk to them in
export function StarterTeamButton({ className }: { className?: string }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  return (
    <Button
      className={className}
      disabled={pending}
      onClick={async () => {
        setPending(true)
        try {
          const { href, name } = await createSquadFromTemplate("starter")
          toast.add({
            type: "success",
            title: `${name} is ready`,
            description: "Atlas, Vega, Rigel and Lyra are online.",
          })
          router.push(href)
        } catch (error) {
          toast.add({
            type: "error",
            title: "Couldn't create the team",
            description: error instanceof Error ? error.message : String(error),
          })
        } finally {
          setPending(false)
        }
      }}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <SparklesIcon data-icon="inline-start" />
      )}
      Create a starter team
    </Button>
  )
}
