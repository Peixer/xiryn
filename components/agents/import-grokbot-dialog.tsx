"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LinkIcon } from "lucide-react"

import { applyGrokbotImport, previewGrokbotImport } from "@/actions/grokbot"
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { GrokbotImportPlan } from "@/lib/grokbot-import"

type Preview = {
  plan: GrokbotImportPlan
  sourceHost: string | null
  sourceLabel: string
}

function payload(url: string, json: string) {
  const link = url.trim()
  const text = json.trim()
  if (link && text) return { error: "Paste a share link or the template JSON, not both." }
  if (link) return { input: { url: link } }
  if (text) return { input: { json: text } }
  return { error: "Paste a share link or the template JSON." }
}

function when(routine: GrokbotImportPlan["routines"][number]) {
  const schedule = routine.schedule
  if (!schedule) return "No schedule"
  if (schedule.kind === "hourly") {
    return schedule.every === 1 ? "Every hour" : `Every ${schedule.every} hours`
  }
  if (schedule.kind === "weekly") return `Weekly, day ${schedule.day} at ${schedule.time}`
  if (schedule.kind === "once") return `Once at ${schedule.at}`
  if (schedule.kind === "weekdays") return `Weekdays at ${schedule.time}`
  return `Every day at ${schedule.time}`
}

export function ImportGrokbotButton({
  variant = "outline",
}: {
  variant?: "outline" | "default"
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <LinkIcon data-icon="inline-start" />
        Import Grok Bot
      </Button>
      <ImportGrokbotDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function ImportGrokbotDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [url, setUrl] = React.useState("")
  const [json, setJson] = React.useState("")
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<"preview" | "apply" | null>(null)
  const request = React.useRef({ url: "", json: "" })

  const reset = () => {
    setUrl("")
    setJson("")
    setPreview(null)
    setError(null)
    request.current = { url: "", json: "" }
  }

  const close = (next: boolean) => {
    if (!next && pending) return
    onOpenChange(next)
    if (!next) reset()
  }

  const edit = (nextUrl: string, nextJson: string) => {
    setUrl(nextUrl)
    setJson(nextJson)
    setPreview(null)
    setError(null)
  }

  const runPreview = async () => {
    const body = payload(url, json)
    if ("error" in body && body.error) {
      setError(body.error)
      setPreview(null)
      return
    }
    setPending("preview")
    setError(null)
    try {
      const outcome = await previewGrokbotImport(body.input)
      if (!outcome.ok) {
        setPreview(null)
        setError(outcome.error)
        return
      }
      request.current = { url: url.trim(), json: json.trim() }
      setPreview({
        plan: outcome.plan,
        sourceHost: outcome.sourceHost,
        sourceLabel: outcome.sourceLabel,
      })
    } catch {
      setPreview(null)
      setError("Couldn't read that template.")
    } finally {
      setPending(null)
    }
  }

  const confirm = async () => {
    if (!preview || pending) return
    const body = payload(request.current.url, request.current.json)
    if (!("input" in body)) return
    setPending("apply")
    try {
      const outcome = await applyGrokbotImport(body.input)
      if (!outcome.ok) {
        toast.add({
          type: "error",
          title: "Couldn't import the agent",
          description: outcome.error,
        })
        return
      }
      toast.add({
        type: "success",
        title: `${outcome.agent.name} imported`,
        description: "Routines are off. Connectors were not installed.",
      })
      onOpenChange(false)
      reset()
      router.refresh()
    } catch {
      toast.add({ type: "error", title: "Couldn't import the agent" })
    } finally {
      setPending(null)
    }
  }

  const plan = preview?.plan

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(90svh,760px)] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="gap-1 border-b px-5 pt-5 pb-4">
          <span className="label-mono">{"// import grok bot"}</span>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Import a Grok Bot agent
          </DialogTitle>
          <DialogDescription>
            Paste the public https share link, or paste the template JSON. Nothing is
            created until you confirm. Routines stay off, and plugins are not installed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-5">
          <Field>
            <FieldLabel htmlFor="grokbot-import-url">Share link</FieldLabel>
            <Input
              id="grokbot-import-url"
              value={url}
              placeholder="https://…"
              spellCheck={false}
              autoCapitalize="off"
              onChange={(event) => edit(event.target.value, json)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="grokbot-import-json">
              Or paste the template JSON
            </FieldLabel>
            <Textarea
              id="grokbot-import-json"
              value={json}
              placeholder='{"profile":{"name":"…"},"skills":[]}'
              className="max-h-36 min-h-20 font-mono text-[12px]"
              spellCheck={false}
              onChange={(event) => edit(url, event.target.value)}
            />
          </Field>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={runPreview}
            >
              {pending === "preview" && <Spinner data-icon="inline-start" />}
              Preview
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}

          {plan && preview && (
            <section className="flex flex-col gap-3 rounded-lg border bg-surface/50 p-3 text-[13px]">
              <h2 className="label-mono">Preview</h2>
              {preview.sourceHost && (
                <p>
                  Fetched from <span className="font-medium">{preview.sourceHost}</span>
                  <span className="mt-1 block font-mono text-[11px] break-all text-muted-foreground">
                    {preview.sourceLabel}
                  </span>
                  Confirm only if you recognise that host. Confirming fetches the link
                  again.
                </p>
              )}
              {!preview.sourceHost && (
                <p className="text-muted-foreground">Source: {preview.sourceLabel}</p>
              )}
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{plan.agent.name}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{plan.agent.role}</dd>
                <dt className="text-muted-foreground">Memories</dt>
                <dd>{plan.memories.length}</dd>
                <dt className="text-muted-foreground">Skills</dt>
                <dd>{plan.skills.length}</dd>
                <dt className="text-muted-foreground">Routines</dt>
                <dd>{plan.routines.length}, all left off</dd>
              </dl>
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">Persona</span>
                <div className="max-h-40 overflow-y-auto rounded-md border bg-background/50 px-3 py-2 leading-relaxed break-words whitespace-pre-wrap">
                  {plan.agent.instructions || (
                    <span className="text-muted-foreground">No persona.</span>
                  )}
                </div>
              </div>
              {plan.skills.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {plan.skills.map((skill) => (
                    <li key={skill.slug}>
                      <span className="font-medium">{skill.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {" "}
                        {skill.slug}
                      </span>
                      {skill.onboarding && (
                        <span className="text-muted-foreground">
                          {" "}
                          · getting started, not run
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {plan.routines.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {plan.routines.map((routine) => (
                    <li key={`${routine.name}-${routine.originalSchedule ?? "none"}`}>
                      <span className="font-medium">{routine.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {when(routine)} · off
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {plan.connectors.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">Connect these yourself</span>
                  <ul className="flex flex-col gap-1">
                    {plan.connectors.map((connector) => (
                      <li key={connector.pluginId}>
                        <span className="font-medium">{connector.name}</span>
                        {connector.equivalent && ` → ${connector.equivalent}. `}
                        <span className="text-muted-foreground">{connector.setup}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.warnings.length > 0 && (
                <ul className="flex flex-col gap-1 text-[12.5px] text-warn">
                  {plan.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-5 py-3">
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="button" disabled={!preview || pending !== null} onClick={confirm}>
            {pending === "apply" && <Spinner data-icon="inline-start" />}
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
