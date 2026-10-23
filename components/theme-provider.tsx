"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

import { pwaThemeColorDark, pwaThemeColorLight } from "@/lib/pwa"

function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  React.useEffect(() => {
    const color = resolvedTheme === "light" ? pwaThemeColorLight : pwaThemeColorDark
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color)
    })
  }, [resolvedTheme])
  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  )
}
