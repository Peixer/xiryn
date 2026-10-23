import type { MetadataRoute } from "next"

// Home-screen shell. The worker and its allowlist live in lib/pwa/cache-policy.ts.
// See docs/pwa.md.

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

// Portrait launch images for current iPhones. A manifest cannot list these;
// Safari reads apple-touch-startup-image.
export const pwaStartupImages = [
  {
    href: "/startup/iphone-16-pro-max.png",
    width: 1320,
    height: 2868,
    media:
      "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-16-pro.png",
    width: 1206,
    height: 2622,
    media:
      "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-16-plus.png",
    width: 1290,
    height: 2796,
    media:
      "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-16.png",
    width: 1179,
    height: 2556,
    media:
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-14-plus.png",
    width: 1284,
    height: 2778,
    media:
      "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-14.png",
    width: 1170,
    height: 2532,
    media:
      "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-x.png",
    width: 1125,
    height: 2436,
    media:
      "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-11.png",
    width: 828,
    height: 1792,
    media:
      "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/startup/iphone-se.png",
    width: 750,
    height: 1334,
    media:
      "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
] as const

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
