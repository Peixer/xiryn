"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UploadIcon } from "lucide-react"

import { importAgent } from "@/actions/agents"
import { Glyph } from "@/components/glyph"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { useWorkspace } from "@/components/workspace/context"
import {
  PORTABLE_AGENT_MAX_BYTES,
  parsePortableAgent,
  prepareAgentImport,
} from "@/lib/agent-portable"

function providerReady(providers: { id: string; configured: boolean }[], id: string) {
  return providers.some((provider) => provider.id === id && provider.configured)
}

export function ImportAgentButton({
  takenNames,
  variant = "outline",
}: {
  takenNames: string[]
  variant?: "outline" | "default"
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <UploadIcon data-icon="inline-start" />
        Import
      </Button>
      <ImportAgentDialog open={open} onOpenChange={setOpen} takenNames={takenNames} />
    </>
  )
}

function ImportAgentDialog({
  open,
  onOpenChange,
  takenNames,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  takenNames: string[]
}) {
  const router = useRouter()
  const { status } = useWorkspace()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [raw, setRaw] = React.useState("")
  const [filename, setFilename] = React.useState<string | null>(null)
  const [blocked, setBlocked] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const reset = () => {
    setRaw("")
    setFilename(null)
    setBlocked(null)
  }

  const close = (next: boolean) => {
    if (!next && submitting) return
    onOpenChange(next)
    if (!next) reset()
  }

  const take = (text: string, name: string | null) => {
    if (
      text.length > PORTABLE_AGENT_MAX_BYTES ||
      new TextEncoder().encode(text).byteLength > PORTABLE_AGENT_MAX_BYTES
    ) {
      setRaw("")
      setFilename(name)
      setBlocked("That file is larger than 256 KB.")
      return
    }
    setBlocked(null)
    setFilename(name)
    setRaw(text)
  }

  const parsed = raw ? parsePortableAgent(raw) : null
  const prepared =
    parsed?.ok === true
      ? prepareAgentImport(parsed.file, {
          takenNames,
          providerConfigured: (id) => providerReady(status.providerOptions, id),
          defaultModel: status.defaultModel,
          glyphFallback: "preview",
        })
      : null
  const error = blocked ?? (parsed && !parsed.ok ? parsed.error : null)

  const confirm = async () => {
    if (!parsed?.ok || submitting) return
    setSubmitting(true)
    try {
      const outcome = await importAgent(raw)
      if (!outcome.ok) {
        toast.add({
          type: "error",
          title: "Couldn't import the agent",
          description: outcome.error,
        })
        return
      }
      const notes = [
        outcome.renamedFrom
          ? `An agent named ${outcome.renamedFrom} is already here, so this one is ${outcome.agent.name}.`
          : null,
        outcome.modelNotice,
      ].filter((note): note is string => !!note)
      toast.add({
        type: "success",
        title: `${outcome.agent.name} imported`,
        description: notes.join(" ") || "Created as a new agent.",
      })
      onOpenChange(false)
      reset()
      router.refresh()
    } catch {
      toast.add({ type: "error", title: "Couldn't import the agent" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(90svh,760px)] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="gap-1 border-b px-5 pt-5 pb-4">
          <span className="label-mono">{"// import agent"}</span>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Import an agent
          </DialogTitle>
          <DialogDescription>
            Choose a <span className="font-mono text-[12px]">.xiryn-agent.json</span> file
            or paste one. The standing orders are shown in full, and nothing is created
            until you confirm. The file stays on this computer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              id="agent-import-file"
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              aria-label="Agent file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (!file) return
                if (file.size > PORTABLE_AGENT_MAX_BYTES) {
                  setRaw("")
                  setFilename(file.name)
                  setBlocked("That file is larger than 256 KB.")
                  return
                }
                void file.text().then(
                  (text) => take(text, file.name),
                  () => {
                    setRaw("")
                    setFilename(file.name)
                    setBlocked("Couldn't read that file.")
                  }
                )
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              <UploadIcon data-icon="inline-start" />
              Choose file
            </Button>
            {filename && (
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {filename}
              </span>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="agent-import-paste">Or paste the JSON</FieldLabel>
            <Textarea
              id="agent-import-paste"
              value={raw}
              placeholder='{"version":1,"kind":"xiryn-agent","agent":{…}}'
              className="max-h-36 min-h-20 font-mono text-[12px]"
              aria-invalid={!!error}
              onChange={(event) => take(event.target.value, null)}
            />
          </Field>

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}

          {prepared && (
            <section className="flex flex-col gap-3 rounded-lg border bg-surface/50 p-3">
              <div className="flex items-center gap-3">
                <Glyph
                  seed={(parsed?.ok && parsed.file.agent.glyph) || prepared.input.name}
                  className="size-9 shrink-0"
                />
                <h2 className="label-mono">Preview</h2>
              </div>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{prepared.input.name}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{prepared.input.role}</dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="break-words">
                  {prepared.input.model ||
                    (status.defaultModel
                      ? `Default (${status.defaultModel})`
                      : "Workspace default")}
                </dd>
              </dl>
              {prepared.renamedFrom && (
                <p className="text-[12.5px] text-muted-foreground">
                  An agent named {prepared.renamedFrom} is already here, so this one will
                  be saved as {prepared.input.name}.
                </p>
              )}
              {prepared.modelNotice && (
                <p className="text-[12.5px] text-warn">{prepared.modelNotice}</p>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">Standing orders</span>
                <div className="max-h-64 overflow-y-auto rounded-md border bg-background/50 px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                  {prepared.input.instructions || (
                    <span className="text-muted-foreground">No standing orders.</span>
                  )}
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                These standing orders are prompt text from the file. Read them before
                importing — they become this agent&apos;s instructions. Confirming creates
                a new agent and never replaces one you already have.
              </p>
            </section>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-5 py-3">
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="button" disabled={!prepared || submitting} onClick={confirm}>
            {submitting && <Spinner data-icon="inline-start" />}
            Import agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
