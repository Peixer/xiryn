"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="xiryn-sheet relative flex max-h-[min(85dvh,720px)] flex-col rounded-t-3xl border border-b-0 bg-popover pb-[env(safe-area-inset-bottom)] shadow-2xl"
      >
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-foreground/15" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 place-items-center rounded-full text-muted-foreground active:bg-accent"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">
          {children}
        </div>
      </div>
    </div>
  )
}
