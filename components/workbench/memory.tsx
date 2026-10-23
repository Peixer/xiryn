"use client"

import * as React from "react"
import { formatDistanceToNowStrict } from "date-fns"
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import {
  addMemory,
  clearMemories,
  deleteMemory,
  listMemories,
  updateMemory,
} from "@/actions/memory"
import { Confirm } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { Memory, MemoryScope } from "@/db/schema"
import { cn } from "@/lib/utils"

export function MemoryPanel({
  agentId,
  refreshKey,
}: {
  agentId: string
  refreshKey: number
}) {
  const [notes, setNotes] = React.useState<Memory[] | null>(null)
  const [draft, setDraft] = React.useState("")
  const [scope, setScope] = React.useState<MemoryScope>("agent")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let live = true
    listMemories(agentId).then((rows) => live && setNotes(rows))
    return () => {
      live = false
    }
  }, [agentId, refreshKey])

  const own = notes?.filter((note) => note.agentId === agentId) ?? []
  const shared = notes?.filter((note) => note.agentId === null) ?? []

  const add = async () => {
    const content = draft.trim()
    if (!content) return
    setSaving(true)
    try {
      setNotes(await addMemory(agentId, content, scope))
      setDraft("")
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't save the note",
        description: String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const forget = async (memoryId: string) => {
    try {
      setNotes(await deleteMemory(agentId, memoryId))
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't forget the note",
        description: String(error),
      })
    }
  }

  const edit = async (memoryId: string, content: string) => {
    setNotes(await updateMemory(agentId, memoryId, content))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Notes for this agent load into its context. Shared notes load into every agent.
          Only you can add, edit, or delete shared notes — an agent can read and search
          them, but cannot write them. Stored only in your local database.
        </p>
        <div className="flex rounded-md border border-input p-0.5">
          {(
            [
              ["agent", "This agent"],
              ["shared", "Shared"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                "h-6 flex-1 rounded-[5px] text-[11.5px]",
                scope === value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
          className="flex gap-1.5"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={scope === "shared" ? "Add a shared note…" : "Add a note…"}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[12.5px] outline-none placeholder:text-faint focus-visible:border-ring dark:bg-input/30"
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="outline"
            disabled={!draft.trim() || saving}
            aria-label={scope === "shared" ? "Add shared note" : "Add note"}
          >
            {saving ? <Spinner /> : <PlusIcon />}
          </Button>
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notes === null ? (
          <div className="grid place-items-center p-6">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-8 text-center">
            <span className="font-mono text-[11px] text-faint">{"// empty"}</span>
            <p className="text-[12.5px] text-muted-foreground">
              Nothing remembered yet. Tell the agent something worth keeping, or add a
              shared note for every agent.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            <NoteSection
              title="This agent"
              empty="No notes for this agent yet."
              notes={own}
              onDelete={forget}
              onUpdate={edit}
            />
            <NoteSection
              title="Shared"
              empty="No shared notes yet."
              notes={shared}
              onDelete={forget}
              onUpdate={edit}
            />
          </div>
        )}
      </div>

      {notes && notes.length > 0 ? (
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <span className="font-mono text-[10.5px] text-faint">
            {own.length} {own.length === 1 ? "note" : "notes"} · {shared.length} shared
          </span>
          {own.length > 0 ? (
            <Confirm
              trigger={
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                >
                  <Trash2Icon data-icon="inline-start" />
                  Clear
                </Button>
              }
              title="Clear this agent's memory?"
              description="Every note belonging to this agent is deleted. Shared notes stay, and other agents' notes are left alone."
              action="Clear memory"
              onConfirm={async () => setNotes(await clearMemories(agentId))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function NoteSection({
  title,
  empty,
  notes,
  onDelete,
  onUpdate,
}: {
  title: string
  empty: string
  notes: Memory[]
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, content: string) => Promise<void>
}) {
  return (
    <section className="border-b last:border-b-0">
      <h3 className="label-mono px-3 pt-3 pb-1">{title}</h3>
      {notes.length === 0 ? (
        <p className="px-3 pb-3 text-[12px] text-faint">{empty}</p>
      ) : (
        <ul className="divide-y">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onDelete={onDelete} onUpdate={onUpdate} />
          ))}
        </ul>
      )}
    </section>
  )
}

function NoteRow({
  note,
  onDelete,
  onUpdate,
}: {
  note: Memory
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, content: string) => Promise<void>
}) {
  const shared = note.agentId === null
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(note.content)
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    const content = draft.trim()
    if (!content || content === note.content) {
      setEditing(false)
      setDraft(note.content)
      return
    }
    setSaving(true)
    try {
      await onUpdate(note.id, content)
      setEditing(false)
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't update the note",
        description: String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="group/note flex gap-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
            className="flex flex-col gap-1.5"
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              className="min-w-0 rounded-md border border-input bg-transparent px-2 py-1 text-[13px] outline-none focus-visible:border-ring dark:bg-input/30"
            />
            <div className="flex gap-1">
              <Button type="submit" size="xs" variant="outline" disabled={saving}>
                {saving ? <Spinner /> : <CheckIcon data-icon="inline-start" />}
                Save
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setDraft(note.content)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-[13px] leading-snug">{note.content}</p>
        )}
        <span className="font-mono text-[10px] text-faint">
          <span className={cn("label-mono", shared ? "text-betelgeuse" : "text-rigel")}>
            {shared ? "Shared" : "Agent"}
          </span>
          {" · "}
          {note.id} ·{" "}
          {formatDistanceToNowStrict(new Date(note.createdAt), { addSuffix: true })}
        </span>
      </div>
      {editing ? null : (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label={shared ? "Edit shared note" : "Edit note"}
            onClick={() => {
              setDraft(note.content)
              setEditing(true)
            }}
            className="grid size-6 place-items-center rounded-sm text-faint hover:bg-accent hover:text-foreground"
          >
            <PencilIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={shared ? "Forget shared note" : "Forget"}
            onClick={() => onDelete(note.id)}
            className="grid size-6 place-items-center rounded-sm text-faint hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  )
}
