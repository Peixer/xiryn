"use client"

import * as React from "react"

// Keeps the composer above the software keyboard. With
// interactive-widget=resizes-content the offset is often zero; visualViewport
// still covers Safari when the layout viewport does not shrink.

export function KeyboardInset() {
  React.useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const apply = () => {
      const overlap = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      )
      document.documentElement.style.setProperty(
        "--xiryn-keyboard",
        `${Math.round(overlap)}px`
      )
    }
    apply()
    viewport.addEventListener("resize", apply)
    viewport.addEventListener("scroll", apply)
    return () => {
      viewport.removeEventListener("resize", apply)
      viewport.removeEventListener("scroll", apply)
      document.documentElement.style.removeProperty("--xiryn-keyboard")
    }
  }, [])
  return null
}
