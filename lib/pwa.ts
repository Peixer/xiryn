import type { MetadataRoute } from "next"

// Home-screen shell. There is no service worker: a worker would cache
// authenticated pages. See docs/pwa.md.

export const pwaName = "Xiryn"
export const pwaShortName = "Xiryn"
export const pwaDescription =
  "Self-hosted AI agents on your own keys: a sandboxed Linux workstation, long-term memory and any model per agent, reachable from Telegram."

// Same hex the viewport already used. Dark is the default theme
// (`components/theme-provider.tsx`); light follows prefers-color-scheme.
export const pwaThemeColorDark = "#14151a"
export const pwaThemeColorLight = "#fafbfc"

export const pwaManifestPath = "/manifest.webmanifest"

export const pwaIcons = [
  {
    src: "/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any" as const,
  },
  {
    src: "/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any" as const,
  },
  {
    src: "/icon-512-maskable.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable" as const,
  },
]

export const pwaAppleTouchIcon = {
  src: "/apple-touch-icon.png",
  sizes: "180x180",
  type: "image/png",
}

export function webAppManifest(): MetadataRoute.Manifest {
  return {
    name: pwaName,
    short_name: pwaShortName,
    description: pwaDescription,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // One pair only. The viewport theme-color still switches with the scheme.
    background_color: pwaThemeColorDark,
    theme_color: pwaThemeColorDark,
    icons: pwaIcons.map((icon) => ({ ...icon })),
  }
}
