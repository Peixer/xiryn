"use client"

import * as React from "react"

import { shouldOfferInstallGuide } from "@/lib/pwa/shell"

const DISMISS = "xiryn.install-guide"

function readGuide() {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  const nav = navigator as Navigator & { standalone?: boolean }
  const standalone =
    nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches
  let dismissed = false
  try {
    dismissed = localStorage.getItem(DISMISS) === "1"
  } catch {
    dismissed = false
  }
  return shouldOfferInstallGuide({ ios, safari, standalone, dismissed })
}

export function InstallGuide({ force }: { force?: boolean }) {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(force || readGuide())
  }, [force])

  if (!open) return null
  return (
    <div className="xiryn-only-app pointer-events-auto mx-3 mb-2 flex-col gap-2 rounded-2xl border bg-popover p-4 shadow-lg">
      <p className="text-[15px] font-semibold tracking-tight">
        Add Xiryn to your Home Screen
      </p>
      <ol className="list-decimal space-y-1 pl-4 text-[13.5px] leading-snug text-muted-foreground">
        <li>Tap Share in Safari.</li>
        <li>Choose Add to Home Screen.</li>
        <li>Open Xiryn from the icon. It runs full screen, without the address bar.</li>
      </ol>
      <p className="text-[12px] leading-snug text-faint">
        iOS has no install button. Push notifications start after it is on your Home
        Screen (iOS 16.4 or later).
      </p>
      <button
        type="button"
        className="self-start text-[13px] font-medium text-rigel"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS, "1")
          } catch {
            // The card can still close for this visit.
          }
          setOpen(false)
        }}
      >
        Not now
      </button>
    </div>
  )
}

export function replayInstallGuide() {
  try {
    localStorage.removeItem(DISMISS)
  } catch {
    // Ignore a blocked storage write.
  }
}
