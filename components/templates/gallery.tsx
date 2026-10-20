"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UsersIcon } from "lucide-react"

import { createSquadFromTemplate } from "@/actions/templates"
import { Glyph, SquadGlyph } from "@/components/glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useWorkspace } from "@/components/workspace/context"
import {
  agentTemplates,
  getAgentTemplate,
  squadTemplates,
  templateCategories,
  type AgentTemplate,
  type SquadTemplate,
} from "@/lib/templates"
import { cn } from "@/lib/utils"

const useLabels: Record<AgentTemplate["uses"][number], string> = {
  desktop: "desktop",
  shell: "shell",
  web: "web",
  vault: "vault",
  memory: "memory",
}

function AgentCard({ template }: { template: AgentTemplate }) {
  const { openAgentDialog, nav } = useWorkspace()
  const made = nav.agents.some(
    (agent) => agent.name === template.name && agent.role === template.role
  )
  return (
    <button
      type="button"
      onClick={() => openAgentDialog({ template })}
      className="group flex flex-col gap-3 rounded-xl border bg-surface/50 p-4 text-left transition-colors hover:border-input hover:bg-surface"
    >
      <div className="flex items-center gap-2.5">
        <Glyph seed={template.glyph} className="size-9" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-[14px] font-semibold">{template.name}</span>
          <span className="line-clamp-1 font-mono text-[10.5px] text-muted-foreground">
            {template.role}
          </span>
        </div>
        {made && (
          <span className="shrink-0 rounded-sm border border-ok/30 px-1.5 py-px font-mono text-[10px] text-ok">
            in use
          </span>
        )}
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {template.blurb}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {template.uses.map((use) => (
          <span
            key={use}
            className="rounded-sm bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground"
          >
            {useLabels[use]}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-rigel opacity-70 transition-opacity group-hover:opacity-100">
          deploy →
        </span>
      </div>
    </button>
  )
}

function SquadCard({ template }: { template: SquadTemplate }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const members = template.members.flatMap((id) => {
    const preset = getAgentTemplate(id)
    return preset ? [preset] : []
  })
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
      <div className="flex items-center gap-3">
        <SquadGlyph seeds={members.map((m) => m.glyph)} className="size-10" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[14px] font-semibold">{template.name}</span>
          <span className="truncate font-mono text-[10.5px] text-muted-foreground">
            {members.map((m) => m.name).join(" · ")}
          </span>
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {template.blurb}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-auto self-start"
        disabled={pending}
        onClick={async () => {
          setPending(true)
          try {
            const { href, name } = await createSquadFromTemplate(template.id)
            toast.add({ type: "success", title: `${name} is ready` })
            router.push(href)
          } catch (error) {
            toast.add({
              type: "error",
              title: "Couldn't create the squad",
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
          <UsersIcon data-icon="inline-start" />
        )}
        Create squad
      </Button>
    </div>
  )
}

export function TemplateGallery() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="label-mono">ready-made squads</h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          A squad is several agents in one thread: ask it anything and the work goes to
          whoever fits. Agents you already made from a template are reused.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {squadTemplates.map((template) => (
            <SquadCard key={template.id} template={template} />
          ))}
        </div>
      </section>

      {templateCategories.map((category) => {
        const items = agentTemplates.filter((t) => t.category === category.id)
        return (
          <section key={category.id} className="flex flex-col gap-3">
            <h2 className="label-mono">{category.label}</h2>
            <div
              className={cn(
                "grid gap-3 sm:grid-cols-2",
                items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
              )}
            >
              {items.map((template) => (
                <AgentCard key={template.id} template={template} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
