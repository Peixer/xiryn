"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react"

import {
  deleteSkill,
  exportAllSkills,
  exportSkill,
  importSkills,
  saveSkill,
} from "@/actions/skills"
import { Confirm } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

type SkillCard = {
  slug: string
  name: string
  description: string
  body: string
}

type SkillWarning = {
  slug: string
  message: string
}

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function SkillDialog({
  open,
  onOpenChange,
  skill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill?: SkillCard
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const name = String(data.get("name") ?? "")
            const description = String(data.get("description") ?? "")
            const body = String(data.get("body") ?? "")
            setSaving(true)
            try {
              const result = await saveSkill({ name, description, body }, skill?.slug)
              if (!result.ok) {
                toast.add({
                  type: "error",
                  title: "Couldn't save",
                  description: result.error,
                })
                return
              }
              toast.add({
                type: "success",
                title: skill ? "Skill saved" : "Skill created",
                description: skill
                  ? undefined
                  : "The next message will list it. The agent reads the full text when it needs it.",
              })
              onOpenChange(false)
              router.refresh()
            } catch (error) {
              toast.add({
                type: "error",
                title: "Couldn't save",
                description: reason(error),
              })
            } finally {
              setSaving(false)
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <DialogTitle>{skill ? "Edit skill" : "New skill"}</DialogTitle>
            <p className="text-[12.5px] text-muted-foreground">
              This text is what the agent follows. It is shown here first, and Xiryn does
              not run code from it.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Name</span>
            <Input
              name="name"
              defaultValue={skill?.name ?? ""}
              maxLength={80}
              required
              placeholder="Invoice filing"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Description</span>
            <Textarea
              name="description"
              defaultValue={skill?.description ?? ""}
              maxLength={1024}
              required
              placeholder="How I want invoices filed"
              className="max-h-32 min-h-16 text-[13px]"
            />
            <span className="text-[11.5px] text-muted-foreground">
              The catalog the agent sees on every turn is just the name and this
              description.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono">Playbook</span>
            <Textarea
              name="body"
              defaultValue={skill?.body ?? ""}
              placeholder={
                "Save PDFs in the invoices folder, named YYYY-MM vendor.\nDon't invent a folder layout."
              }
              className="max-h-64 min-h-36 font-mono text-[12.5px]"
            />
          </label>

          {skill && (
            <p className="font-mono text-[10.5px] text-muted-foreground">
              data/skills/{skill.slug}/SKILL.md
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner data-icon="inline-start" />}
              {skill ? "Save skill" : "Create skill"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SkillRow({ skill }: { skill: SkillCard }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium tracking-tight">{skill.name}</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {skill.slug}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-foreground/90">
        {skill.description}
      </p>
      <pre className="max-h-48 overflow-auto rounded-md border bg-background/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/90">
        {skill.body || "No playbook text yet."}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const result = await exportSkill(skill.slug)
              if (!result.ok) {
                toast.add({
                  type: "error",
                  title: "Couldn't export",
                  description: result.error,
                })
                return
              }
              download(result.filename, result.content, result.mediaType)
            } catch (error) {
              toast.add({
                type: "error",
                title: "Couldn't export",
                description: reason(error),
              })
            } finally {
              setBusy(false)
            }
          }}
        >
          <DownloadIcon data-icon="inline-start" />
          Export
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          onClick={() => setDeleting(true)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </div>
      {editing && <SkillDialog open={editing} onOpenChange={setEditing} skill={skill} />}
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete "${skill.name}"?`}
        description="The agent will stop seeing this playbook. Nothing else is removed."
        action="Delete skill"
        onConfirm={async () => {
          const result = await deleteSkill(skill.slug)
          if (!result.ok) {
            toast.add({
              type: "error",
              title: "Couldn't delete",
              description: result.error,
            })
            return
          }
          toast.add({ type: "success", title: "Skill deleted" })
          router.refresh()
        }}
      />
    </article>
  )
}

export function SkillsView({
  skills,
  warnings,
}: {
  skills: SkillCard[]
  warnings: SkillWarning[]
}) {
  const router = useRouter()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [creating, setCreating] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  return (
    <div className="flex flex-col gap-8">
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-betelgeuse/40 bg-betelgeuse-soft px-4 py-3 text-[12.5px] leading-relaxed text-betelgeuse">
          <span className="label-mono">{"// skipped"}</span>
          <ul className="flex flex-col gap-2">
            {warnings.map((warning, index) => (
              <li
                key={`${warning.slug}-${index}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span>
                  {warning.slug ? `${warning.slug}: ` : ""}
                  {warning.message}
                </span>
                {SAFE_SLUG.test(warning.slug) && (
                  <button
                    type="button"
                    className="font-mono text-[10.5px] underline underline-offset-2"
                    onClick={async () => {
                      const result = await deleteSkill(warning.slug)
                      if (!result.ok) {
                        toast.add({
                          type: "error",
                          title: "Couldn't remove it",
                          description: result.error,
                        })
                        return
                      }
                      router.refresh()
                    }}
                  >
                    Remove file
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          New skill
        </Button>
        <Button
          variant="outline"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadIcon data-icon="inline-start" />
          )}
          Import
        </Button>
        <Button
          variant="outline"
          disabled={exporting || skills.length === 0}
          onClick={async () => {
            setExporting(true)
            try {
              const result = await exportAllSkills()
              download(result.filename, result.content, result.mediaType)
            } catch (error) {
              toast.add({
                type: "error",
                title: "Couldn't export",
                description: reason(error),
              })
            } finally {
              setExporting(false)
            }
          }}
        >
          {exporting ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          Export all
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.json,text/markdown,application/json"
          aria-label="Import a skill file"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (!file) return
            if (file.size > 2 * 1024 * 1024) {
              toast.add({
                type: "error",
                title: "Couldn't import",
                description: "That import is larger than 2 MB.",
              })
              return
            }
            setImporting(true)
            try {
              const result = await importSkills(await file.text(), file.name)
              if (!result.ok) {
                toast.add({
                  type: "error",
                  title: "Couldn't import",
                  description: result.error,
                })
                return
              }
              const count = result.imported.length
              toast.add({
                type: result.warnings.length > 0 ? "warning" : "success",
                title: `Imported ${count} skill${count === 1 ? "" : "s"}`,
                description:
                  result.warnings.length > 0
                    ? result.warnings.map((warning) => warning.message).join(" ")
                    : undefined,
              })
              router.refresh()
            } catch (error) {
              toast.add({
                type: "error",
                title: "Couldn't import",
                description: reason(error),
              })
            } finally {
              setImporting(false)
            }
          }}
        />
      </div>

      {skills.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No skills yet. Write one, or import a SKILL.md file.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {skills.map((skill) => (
            <SkillRow key={skill.slug} skill={skill} />
          ))}
        </div>
      )}

      {creating && <SkillDialog open={creating} onOpenChange={setCreating} />}
    </div>
  )
}
