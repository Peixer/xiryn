"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  BotIcon,
  BrainIcon,
  DatabaseIcon,
  GlobeIcon,
  KeyRoundIcon,
  MonitorIcon,
  ShuffleIcon,
  SparklesIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react"
import { nanoid } from "nanoid"
import { Controller, useForm, useWatch } from "react-hook-form"

import { createAgent, deleteAgent, updateAgent } from "@/actions/agents"
import { reportDeletion } from "@/components/agents/delete-feedback"
import { Confirm } from "@/components/confirm"
import { Glyph } from "@/components/glyph"
import { ModelPicker } from "@/components/model-picker"
import {
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type AgentCategory,
} from "@/lib/agent-categories"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  agentTemplates,
  templateCategories,
  useWorkspace,
  type AgentTemplate,
  type TemplateCategory,
} from "@/components/workspace/context"
import { agentInputSchema } from "@/db/schema"
import type { NavAgent } from "@/queries/workspace"
import { cn } from "@/lib/utils"

// ─── Capability chip icons ────────────────────────────────────────────────────

type UseTag = "desktop" | "shell" | "web" | "vault" | "memory"

const useConfig: Record<UseTag, { label: string; icon: React.ElementType }> = {
  desktop: { label: "Desktop", icon: MonitorIcon },
  shell: { label: "Shell", icon: TerminalIcon },
  web: { label: "Web", icon: GlobeIcon },
  vault: { label: "Vault", icon: KeyRoundIcon },
  memory: { label: "Memory", icon: BrainIcon },
}

function CapabilityChip({ tag }: { tag: UseTag }) {
  const { label, icon: Icon } = useConfig[tag] ?? { label: tag, icon: DatabaseIcon }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
      <Icon className="size-2.5 shrink-0" />
      {label}
    </span>
  )
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({
  preset,
  active,
  onClick,
}: {
  preset: AgentTemplate
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-all",
        active
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
          : "border-border/60 bg-background/40 hover:border-input hover:bg-accent/40"
      )}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span className="truncate text-[12px] leading-tight font-semibold">
          {preset.name}
        </span>
        {active && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] text-primary">
            selected
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
        {preset.blurb}
      </p>
      <div className="flex flex-wrap gap-1">
        {preset.uses.map((tag) => (
          <CapabilityChip key={tag} tag={tag as UseTag} />
        ))}
      </div>
    </button>
  )
}

// ─── Main form ────────────────────────────────────────────────────────────────

function AgentForm({ agent, template }: { agent?: NavAgent; template?: AgentTemplate }) {
  const router = useRouter()
  const { status, closeDialog } = useWorkspace()

  const [initialGlyph] = React.useState(
    () => agent?.glyph ?? template?.glyph ?? nanoid(10)
  )
  const [activeCategory, setActiveCategory] = React.useState<TemplateCategory>("everyday")
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(
    template?.id ?? null
  )

  const form = useForm({
    resolver: zodResolver(agentInputSchema),
    defaultValues: {
      name: agent?.name ?? template?.name ?? "",
      role: agent?.role ?? template?.role ?? "",
      instructions: agent?.instructions ?? template?.instructions ?? "",
      model: agent?.model ?? "",
      category: agent?.category ?? template?.agentCategory ?? "general",
      glyph: initialGlyph,
    },
  })

  const { isSubmitting } = form.formState

  const applyTemplate = (preset: AgentTemplate) => {
    const options = { shouldDirty: true, shouldValidate: true }
    form.setValue("name", preset.name, options)
    form.setValue("role", preset.role, options)
    form.setValue("instructions", preset.instructions, options)
    form.setValue("glyph", preset.glyph, options)
    form.setValue("category", preset.agentCategory ?? "general", options)
    setSelectedPresetId(preset.id)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (agent) {
        const updated = await updateAgent(agent.id, values)
        toast.add({ type: "success", title: `${updated.name} updated` })
        closeDialog()
      } else {
        const { agent: created, threadId } = await createAgent(values)
        toast.add({ type: "success", title: `${created.name} is online` })
        closeDialog()
        router.push(`/a/${created.id}/${threadId}`)
      }
    } catch (error) {
      toast.add({
        type: "error",
        title: agent ? "Couldn't save the agent" : "Couldn't create the agent",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  })

  const instructions = useWatch({ control: form.control, name: "instructions" }) ?? ""

  const filteredTemplates = agentTemplates.filter((t) => t.category === activeCategory)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
      {/* Header */}
      <DialogHeader className="gap-1 border-b px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            <BotIcon className="size-3" />
            {agent ? "configure" : "new agent"}
          </span>
        </div>
        <DialogTitle className="text-lg font-semibold tracking-tight">
          {agent ? agent.name : "Create an agent"}
        </DialogTitle>
        <DialogDescription className="text-[13px]">
          {agent
            ? "Identity, standing orders and the model it thinks with."
            : "Give your agent a name, a role, and standing orders. It gets its own workstation, memory and model."}
        </DialogDescription>
      </DialogHeader>

      {/* Body: two-column on create, single-column on edit */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Left: template picker (create only) ── */}
        {!agent && (
          <aside className="flex w-52 shrink-0 flex-col border-r">
            {/* Category tabs */}
            <div className="flex flex-col gap-0.5 border-b px-2.5 py-2.5">
              <span className="mb-1 px-1 font-mono text-[9.5px] tracking-widest text-muted-foreground/70 uppercase">
                Start from a template
              </span>
              {templateCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition-colors",
                    activeCategory === cat.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Template cards */}
            <div className="flex flex-col gap-1.5 overflow-y-auto px-2.5 py-2.5">
              {filteredTemplates.map((preset) => (
                <TemplateCard
                  key={preset.id}
                  preset={preset}
                  active={selectedPresetId === preset.id}
                  onClick={() => applyTemplate(preset)}
                />
              ))}
            </div>
          </aside>
        )}

        {/* ── Right: form fields ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          {/* Glyph + Name + Role row */}
          <FieldGroup className="gap-4">
            <div className="flex items-start gap-4">
              {/* Glyph picker */}
              <Controller
                name="glyph"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="overflow-hidden rounded-xl ring-1 ring-border/60">
                      <Glyph seed={field.value ?? initialGlyph} className="size-[60px]" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = nanoid(10)
                        field.onChange(next)
                        setSelectedPresetId(null)
                      }}
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ShuffleIcon className="size-3" />
                      reroll
                    </button>
                  </div>
                )}
              />

              {/* Name + Role stacked */}
              <div className="grid flex-1 gap-3">
                <Controller
                  name="name"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="agent-name">Name</FieldLabel>
                      <Input
                        {...field}
                        id="agent-name"
                        placeholder="Vega"
                        autoComplete="off"
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
                <Controller
                  name="role"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="agent-role">Role</FieldLabel>
                      <Input
                        {...field}
                        id="agent-role"
                        placeholder="Research analyst"
                        autoComplete="off"
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>
            </div>

            {/* Model picker */}
            <Controller
              name="model"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="agent-model">Model</FieldLabel>
                  <ModelPicker
                    id="agent-model"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    providers={status.providerOptions}
                    defaultSpec={status.defaultModel}
                    allowDefault
                    invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Workstation tasks need a model that supports tools and images.
                  </FieldDescription>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="category"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-medium">Category</legend>
                    {(Object.keys(CATEGORY_LABELS) as AgentCategory[]).map((category) => (
                      <label key={category} className="flex items-start gap-3 text-sm">
                        <input
                          type="radio"
                          name={field.name}
                          value={category}
                          checked={field.value === category}
                          onChange={() => field.onChange(category)}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                        <span>
                          <span className="font-medium">{CATEGORY_LABELS[category]}</span>
                          <span className="block text-muted-foreground">
                            {CATEGORY_DESCRIPTIONS[category]}
                          </span>
                          {category === "coding" && (
                            <span className="block text-muted-foreground">
                              The first coding agent you create owns the credentials.
                              Others get read-only access.
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </Field>
              )}
            />

            {/* Standing orders / instructions */}
            <Controller
              name="instructions"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-baseline justify-between">
                    <FieldLabel htmlFor="agent-instructions">Standing orders</FieldLabel>
                    <div className="flex items-center gap-2">
                      {/* Rough token estimate (~4 chars/token) */}
                      <span className="font-mono text-[10px] text-faint tabular-nums">
                        ~{Math.ceil(instructions.length / 4)} tokens
                      </span>
                      <span className="font-mono text-[10px] text-faint tabular-nums">
                        {instructions.length}
                        <span className="text-muted-foreground/50">/6000</span>
                      </span>
                    </div>
                  </div>
                  <Textarea
                    {...field}
                    value={field.value ?? ""}
                    id="agent-instructions"
                    placeholder="How should it work? What should it always or never do?"
                    className="max-h-52 min-h-[6.5rem] text-[13px] leading-relaxed"
                    aria-invalid={fieldState.invalid}
                  />
                  {/* Hint bar */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <SparklesIcon className="size-3 text-muted-foreground/50" />
                    <p className="text-[11px] text-muted-foreground/60">
                      Describe its personality, what tools to prefer, what it must never
                      do, and how to handle ambiguity.
                    </p>
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </div>
      </div>

      {/* Footer */}
      <DialogFooter className="mx-0 mb-0 items-center rounded-b-xl border-t bg-muted/30 px-5 py-3">
        {agent && (
          <Confirm
            trigger={
              <Button
                type="button"
                variant="ghost"
                className="text-destructive sm:mr-auto"
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            }
            title={`Delete ${agent.name}?`}
            description={
              <>
                {agent.busy && (
                  <span className="mb-2 block font-medium text-destructive">
                    {agent.name} is working right now. Its current task will be stopped.
                  </span>
                )}
                Its threads and messages, its memory, its routines and its workstation
                (the Docker container and every file on it) are deleted. This can&apos;t
                be undone.
              </>
            }
            action={agent.busy ? "Stop and delete" : "Delete agent"}
            onConfirm={async () => {
              const outcome = await deleteAgent(agent.id, {
                stopRunning: agent.busy,
              })
              if (reportDeletion(outcome)) {
                closeDialog()
                router.push("/")
              }
            }}
          />
        )}
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {agent ? "Save changes" : "Create agent"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─── Dialog shell ─────────────────────────────────────────────────────────────

export function AgentDialog() {
  const { dialog, closeDialog } = useWorkspace()
  const state = dialog?.kind === "agent" ? dialog : null

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          // Wider when creating (template sidebar), narrower when editing
          state?.agent
            ? "max-h-[min(90svh,700px)] sm:max-w-xl"
            : "max-h-[min(90svh,680px)] sm:max-w-3xl"
        )}
      >
        {state && (
          <AgentForm
            key={state.agent?.id ?? state.template?.name ?? "new"}
            agent={state.agent}
            template={state.template}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
