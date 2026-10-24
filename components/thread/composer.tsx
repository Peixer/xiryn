"use client"

import * as React from "react"
import {
  ArrowUpIcon,
  CameraIcon,
  ChevronDownIcon,
  FileIcon,
  MicIcon,
  PaperclipIcon,
  ShareIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { hapticTap } from "@/components/app/haptic"

import { Glyph } from "@/components/glyph"
import { ModelSpecLabel } from "@/components/model-picker"
import { useDictation } from "@/components/thread/dictation"
import type { AgentLite } from "@/components/thread/transcript"
import {
  formatBytes,
  isImageMedia,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  mediaTypeFor,
} from "@/lib/attachments"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

type PendingFile = { id: string; file: File; url?: string }

function hasDraggedFiles(event: React.DragEvent) {
  return [...event.dataTransfer.types].includes("Files")
}

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
  onSend: (text: string, files: File[]) => void | Promise<void>
  onStop: () => void
  members?: AgentLite[]
  addressee?: AgentLite
  onAddresseeChange?: (agentId: string) => void
  modelSpec: string | null
  draftKey: string
}) {
  const [text, setText] = React.useState("")
  const [files, setFiles] = React.useState<PendingFile[]>([])
  const [sending, setSending] = React.useState(false)
  const sendingRef = React.useRef(false)
  const [dragOver, setDragOver] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const cameraRef = React.useRef<HTMLInputElement>(null)
  const dragDepth = React.useRef(0)
  const filesRef = React.useRef(files)
  React.useEffect(() => {
    filesRef.current = files
  }, [files])
  React.useEffect(() => {
    return () => {
      for (const item of filesRef.current) if (item.url) URL.revokeObjectURL(item.url)
    }
  }, [])

  const clearFiles = React.useCallback(() => {
    setFiles((current) => {
      for (const item of current) if (item.url) URL.revokeObjectURL(item.url)
      return []
    })
  }, [])

  // Unsent drafts survive navigation between threads. Files do not: they
  // belong to the thread you dropped them on.
  React.useEffect(() => {
    try {
      // Restoring from browser storage is exactly what effects are for
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(sessionStorage.getItem(`xiryn:draft:${draftKey}`) ?? "")
    } catch {}
    clearFiles()
    ref.current?.focus()
  }, [draftKey, clearFiles])

  React.useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`xiryn:draft:${draftKey}`, text)
      else sessionStorage.removeItem(`xiryn:draft:${draftKey}`)
    } catch {}
  }, [text, draftKey])

  // Voice typing: what was in the box before speaking, then the words
  // heard so far. Null once the text has been sent, so late results from
  // the recogniser don't bring it back.
  const spokenAfter = React.useRef<string | null>(null)
  const dictation = useDictation({
    onText: (final, interim) => {
      if (spokenAfter.current === null) return
      setText(spokenAfter.current + final + interim)
    },
    onProblem: (message) => toast.add({ type: "error", title: message }),
  })
  const listening = dictation.state === "listening" || dictation.state === "starting"

  const startDictation = () => {
    spokenAfter.current = text && !/\s$/.test(text) ? `${text} ` : text
    void dictation.start()
    ref.current?.focus()
  }

  const addFiles = (list: File[]) => {
    if (list.length === 0 || disabled || busy || sending) return
    setFiles((current) => {
      const next = [...current]
      for (const file of list) {
        if (next.length >= MAX_FILES_PER_MESSAGE) {
          toast.add({
            type: "error",
            title: `You can attach up to ${MAX_FILES_PER_MESSAGE} files.`,
          })
          break
        }
        if (file.size > MAX_FILE_BYTES) {
          toast.add({
            type: "error",
            title: `"${file.name || "file"}" is larger than ${formatBytes(MAX_FILE_BYTES)}.`,
          })
          continue
        }
        const mediaType = mediaTypeFor(file.name || "file", file.type)
        next.push({
          id: crypto.randomUUID(),
          file,
          url: isImageMedia(mediaType) ? URL.createObjectURL(file) : undefined,
        })
      }
      return next
    })
  }

  const removeFile = (id: string) => {
    setFiles((current) => {
      const file = current.find((item) => item.id === id)
      if (file?.url) URL.revokeObjectURL(file.url)
      return current.filter((item) => item.id !== id)
    })
  }

  const submit = async () => {
    const value = text.trim()
    if (busy || disabled || sendingRef.current) return
    if (!value && files.length === 0) return
    if (listening) {
      spokenAfter.current = null
      dictation.stop()
    }
    const sendingFiles = files.map((item) => item.file)
    sendingRef.current = true
    setSending(true)
    try {
      await onSend(value, sendingFiles)
      hapticTap()
      setText("")
      clearFiles()
    } catch {
      // The caller shows the error. Keep the draft and the chips.
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const canSend = (text.trim().length > 0 || files.length > 0) && !disabled && !sending

  return (
    <div className="xiryn-composer mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className={cn(
          "group/composer relative rounded-xl border bg-surface shadow-[0_1px_0_0_var(--hairline),0_8px_24px_-12px_rgb(0_0_0/0.35)] transition-colors focus-within:border-input",
          busy && "border-rigel/30",
          dragOver && "border-rigel"
        )}
        onDragEnter={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          dragDepth.current += 1
          setDragOver(true)
        }}
        onDragOver={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        onDrop={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          dragDepth.current = 0
          setDragOver(false)
          addFiles([...event.dataTransfer.files])
        }}
      >
        {busy && (
          <div className="absolute inset-x-6 -top-px h-px bg-linear-to-r from-transparent via-rigel to-transparent" />
        )}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border border-dashed border-rigel bg-rigel/10 font-mono text-[11px] text-rigel">
            Drop files to attach
          </div>
        )}
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {files.map((item) => (
              <li
                key={item.id}
                className="flex max-w-full items-center gap-1.5 rounded-lg border bg-background/70 py-1 pr-1 pl-1"
              >
                {item.url ? (
                  // The name sits beside the picture
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="size-8 rounded-md object-cover" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-md bg-accent text-muted-foreground">
                    <FileIcon className="size-3.5" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block max-w-40 truncate text-[12px] leading-tight">
                    {item.file.name || "file"}
                  </span>
                  <span className="block font-mono text-[10px] text-faint">
                    {formatBytes(item.file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Share ${item.file.name || "file"}`}
                  onClick={() => {
                    const file = item.file
                    const nav = navigator as Navigator & {
                      canShare?: (data: { files?: File[] }) => boolean
                    }
                    if (nav.share && nav.canShare?.({ files: [file] })) {
                      void nav.share({ files: [file], title: file.name }).catch(() => {})
                      return
                    }
                    toast.add({
                      type: "error",
                      title: "This browser can't share that file.",
                    })
                  }}
                  className="xiryn-share grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ShareIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${item.file.name || "file"}`}
                  onClick={() => removeFile(item.id)}
                  disabled={sending}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(event) => {
            // Typing takes over from the microphone
            if (listening) {
              spokenAfter.current = null
              dictation.stop()
            }
            setText(event.target.value)
          }}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files]
            if (pasted.length === 0) return
            addFiles(pasted)
          }}
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
          enterKeyHint="send"
          placeholder={placeholder}
          disabled={disabled || sending}
          className="block [field-sizing:content] max-h-64 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-relaxed outline-none placeholder:text-faint disabled:opacity-50 md:text-[14px]"
        />
        <div className="xiryn-composer-actions flex items-center gap-2 px-2.5 pt-1 pb-2.5 max-md:min-w-0 max-md:gap-1.5 max-md:px-2 max-md:pb-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
            disabled={disabled || sending}
            className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <PaperclipIcon className="size-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            aria-label="Take a photo"
            disabled={disabled || sending || busy}
            className="xiryn-camera grid size-11 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground active:bg-accent disabled:opacity-30"
          >
            <CameraIcon className="size-5" />
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
          {members && addressee && onAddresseeChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex h-7 items-center gap-1.5 rounded-md border bg-background/50 px-2 text-[12px] hover:bg-accent max-md:max-w-36 max-md:min-w-0 max-md:shrink">
                <span className="font-mono text-[10.5px] text-muted-foreground">to</span>
                <Glyph seed={addressee.glyph} className="size-4 rounded-[4px]" />
                <span className="max-md:truncate">{addressee.name}</span>
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
              className="hidden max-w-56 px-1 text-[11px] text-muted-foreground md:inline-flex"
            />
          )}
          {listening ? (
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-destructive">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-destructive text-destructive" />
              {dictation.state === "starting" ? "starting…" : "listening"}
              <span className="hidden text-faint sm:inline">
                · {dictation.local ? "on this device" : "your browser's speech service"}
              </span>
            </span>
          ) : (
            <span className="ml-auto hidden font-mono text-[10.5px] text-faint sm:inline">
              ↵ send · ⇧↵ newline
            </span>
          )}
          {dictation.state !== "unsupported" && (
            <button
              type="button"
              onClick={() => (listening ? dictation.stop() : startDictation())}
              aria-label={listening ? "Stop voice typing" : "Voice typing"}
              aria-pressed={listening}
              title={listening ? "Stop voice typing" : "Speak your message"}
              disabled={disabled || sending}
              className={cn(
                "relative grid size-8 shrink-0 place-items-center rounded-lg border transition-colors disabled:opacity-30",
                listening
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {listening && (
                <span className="absolute inset-0 animate-ping rounded-lg border border-destructive/40" />
              )}
              <MicIcon className="size-4" />
            </button>
          )}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the agent"
              className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-foreground transition-colors hover:bg-accent"
            >
              <SquareIcon className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!canSend}
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
