"use client"

import * as React from "react"
import { ArrowUpIcon, ChevronDownIcon, SquareIcon } from "lucide-react"

import { Glyph } from "@/components/glyph"
import { ModelSpecLabel } from "@/components/model-picker"
import type { AgentLite } from "@/components/thread/transcript"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function Composer({
  placeholder,
  busy,
  disabled,
  onSend,
  onStop,
  members,
  addressee,
  onAddresseeChange,
  modelSpec,
  draftKey,
}: {
  placeholder: string
  busy: boolean
  disabled?: boolean
  onSend: (text: string) => void
  onStop: () => void
  members?: AgentLite[]
  addressee?: AgentLite
  onAddresseeChange?: (agentId: string) => void
  modelSpec: string | null
  draftKey: string
}) {
  const [text, setText] = React.useState("")
  const ref = React.useRef<HTMLTextAreaElement>(null)

  // Unsent drafts survive navigation between threads
  React.useEffect(() => {
    try {
      // Restoring from browser storage is exactly what effects are for
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(sessionStorage.getItem(`oryn:draft:${draftKey}`) ?? "")
    } catch {}
    ref.current?.focus()
  }, [draftKey])

  React.useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`oryn:draft:${draftKey}`, text)
      else sessionStorage.removeItem(`oryn:draft:${draftKey}`)
    } catch {}
  }, [text, draftKey])

  const submit = () => {
    const value = text.trim()
    if (!value || busy || disabled) return
    onSend(value)
    setText("")
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className={cn(
          "group/composer relative rounded-xl border bg-surface shadow-[0_1px_0_0_var(--hairline),0_8px_24px_-12px_rgb(0_0_0/0.35)] transition-colors focus-within:border-input",
          busy && "border-rigel/30"
        )}
      >
        {busy && (
          <div className="absolute inset-x-6 -top-px h-px bg-linear-to-r from-transparent via-rigel to-transparent" />
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          className="block [field-sizing:content] max-h-64 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed outline-none placeholder:text-faint disabled:opacity-50"
        />
        <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
          {members && addressee && onAddresseeChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex h-7 items-center gap-1.5 rounded-md border bg-background/50 px-2 text-[12px] hover:bg-accent">
                <span className="font-mono text-[10.5px] text-muted-foreground">to</span>
                <Glyph seed={addressee.glyph} className="size-4 rounded-[4px]" />
                {addressee.name}
                <ChevronDownIcon className="size-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {members.map((member) => (
                  <DropdownMenuItem
                    key={member.id}
                    onClick={() => onAddresseeChange(member.id)}
                  >
                    <Glyph seed={member.glyph} className="size-5" />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate">{member.name}</span>
                      <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                        {member.role}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {modelSpec && (
            <ModelSpecLabel
              spec={modelSpec}
              className="max-w-56 px-1 text-[11px] text-muted-foreground"
            />
          )}
          <span className="ml-auto hidden font-mono text-[10.5px] text-faint sm:inline">
            ↵ send · ⇧↵ newline
          </span>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the agent"
              className="grid size-8 place-items-center rounded-lg border bg-background text-foreground transition-colors hover:bg-accent"
            >
              <SquareIcon className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || disabled}
              className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
