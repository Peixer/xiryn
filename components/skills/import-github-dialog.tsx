"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LinkIcon } from "lucide-react"

import { importGithubSkillSelection, previewGithubSkillImport } from "@/actions/skills"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { toast } from "@/components/ui/toast"

type Preview = Extract<
  Awaited<ReturnType<typeof previewGithubSkillImport>>,
  { ok: true }
>["preview"]

export function ImportGithubSkillsButton() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LinkIcon data-icon="inline-start" />
        From GitHub
      </Button>
      <ImportGithubSkillsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function ImportGithubSkillsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [url, setUrl] = React.useState("")
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [selected, setSelected] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<"preview" | "apply" | null>(null)
  const requested = React.useRef("")

  const reset = () => {
    setUrl("")
    setPreview(null)
    setSelected([])
    setError(null)
    requested.current = ""
  }

  const close = (next: boolean) => {
    if (!next && pending) return
    onOpenChange(next)
    if (!next) reset()
  }

  const edit = (next: string) => {
    setUrl(next)
    setPreview(null)
    setSelected([])
    setError(null)
  }

  const selectable = preview?.skills.filter((skill) => skill.canSave) ?? []
  const chosen = selectable.filter((skill) => selected.includes(skill.slug))

  const runPreview = async () => {
    setPending("preview")
    setError(null)
    try {
      const outcome = await previewGithubSkillImport(url)
      if (!outcome.ok) {
        setPreview(null)
        setSelected([])
        setError(outcome.error)
        return
      }
      requested.current = url.trim()
      setPreview(outcome.preview)
      setSelected(
        outcome.preview.skills.filter((skill) => skill.canSave).map((skill) => skill.slug)
      )
    } catch {
      setPreview(null)
      setSelected([])
      setError("Couldn't read that GitHub folder.")
    } finally {
      setPending(null)
    }
  }

  const confirm = async () => {
    if (!preview || pending || chosen.length === 0) return
    setPending("apply")
    try {
      const outcome = await importGithubSkillSelection(
        requested.current,
        chosen.map((skill) => skill.slug)
      )
      if (!outcome.ok) {
        toast.add({
          type: "error",
          title: "Couldn't import",
          description: outcome.error,
        })
        return
      }
      const count = outcome.imported.length
      toast.add({
        type: outcome.warnings.length > 0 ? "warning" : "success",
        title: `Imported ${count} skill${count === 1 ? "" : "s"} from GitHub`,
        description:
          outcome.warnings.length > 0
            ? outcome.warnings
                .slice(0, 3)
                .map((warning) => warning.message)
                .join(" ")
            : "The next message will list them. The agent treats an imported playbook as untrusted until you edit and save it.",
      })
      onOpenChange(false)
      reset()
      router.refresh()
    } catch {
      toast.add({ type: "error", title: "Couldn't import" })
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(90svh,760px)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="gap-1 border-b px-5 pt-5 pb-4">
          <span className="label-mono">{"// import from github"}</span>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Import skills from GitHub
          </DialogTitle>
          <DialogDescription>
            Paste a public link to a folder of skills, or to one SKILL.md file. Xiryn
            reads the files and lists them here. Nothing is saved until you import.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (pending === null) void runPreview()
          }}
        >
          <Field>
            <FieldLabel htmlFor="github-skills-url">GitHub link</FieldLabel>
            <Input
              id="github-skills-url"
              value={url}
              placeholder="https://github.com/cursor/plugins/tree/main/pstack/skills"
              spellCheck={false}
              autoCapitalize="off"
              autoFocus
              onChange={(event) => edit(event.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={pending !== null}>
              {pending === "preview" && <Spinner data-icon="inline-start" />}
              Preview
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}

          {preview && (
            <section className="flex flex-col gap-3 rounded-lg border bg-surface/50 p-3 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="label-mono">Preview</h2>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="font-mono text-[10.5px] text-muted-foreground underline underline-offset-2"
                    onClick={() => setSelected(selectable.map((skill) => skill.slug))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="font-mono text-[10.5px] text-muted-foreground underline underline-offset-2"
                    onClick={() => setSelected([])}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p>
                <a
                  href={preview.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  {preview.label}
                </a>
              </p>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                These are instructions from that repository. Read each playbook before you
                save it. Xiryn does not run them. Import fetches the folder again.
              </p>
              {preview.warnings.length > 0 && (
                <ul className="flex flex-col gap-1 text-[12.5px] text-betelgeuse">
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.path}-${index}`}>
                      {warning.path ? `${warning.path}: ` : ""}
                      {warning.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col divide-y rounded-md border bg-background/40">
                {preview.skills.map((skill) => {
                  const on = selected.includes(skill.slug)
                  return (
                    <div key={skill.path} className="flex flex-col gap-2 px-3 py-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <Checkbox
                          className="mt-0.5"
                          checked={on}
                          disabled={!skill.canSave || pending !== null}
                          onCheckedChange={(next) =>
                            setSelected((current) =>
                              next
                                ? current.includes(skill.slug)
                                  ? current
                                  : [...current, skill.slug]
                                : current.filter((slug) => slug !== skill.slug)
                            )
                          }
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="font-medium">{skill.name}</span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            {skill.slug}
                          </span>
                          <span className="text-[12.5px] leading-relaxed text-foreground/90">
                            {skill.description}
                          </span>
                          {skill.replaced && (
                            <span className="text-[11.5px] text-betelgeuse">
                              Replaces the skill already saved here.
                            </span>
                          )}
                          {!skill.canSave && (
                            <span className="text-[11.5px] text-betelgeuse">
                              The library is full, so this one can&apos;t be saved yet.
                            </span>
                          )}
                        </span>
                      </label>
                      <details className="pl-7">
                        <summary className="cursor-pointer text-[12px] text-muted-foreground">
                          Playbook
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-background/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
                          {skill.body || "No playbook text."}
                        </pre>
                      </details>
                    </div>
                  )
                })}
              </div>
              <p className="text-[12px] text-muted-foreground">
                {chosen.length} of {selectable.length} selected
                {chosen.some((skill) => skill.replaced)
                  ? ` · ${chosen.filter((skill) => skill.replaced).length} replace a saved skill`
                  : ""}
              </p>
            </section>
          )}
        </form>

        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-5 py-3">
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            disabled={!preview || chosen.length === 0 || pending !== null}
            onClick={() => void confirm()}
          >
            {pending === "apply" && <Spinner data-icon="inline-start" />}
            {chosen.length === 0
              ? "Import"
              : chosen.length === 1
                ? "Import 1 skill"
                : `Import ${chosen.length} skills`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
