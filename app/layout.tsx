import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  pwaAppleTouchIcon,
  pwaDescription,
  pwaIcons,
  pwaManifestPath,
  pwaName,
  pwaThemeColorDark,
  pwaThemeColorLight,
} from "@/lib/pwa"
import { cn } from "@/lib/utils"

// Fonts ship with the app (npm, SIL OFL); nothing is fetched from a font CDN
const inter = localFont({
  src: [
    {
      path: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      weight: "100 900",
    },
    {
      path: "../node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
      weight: "100 900",
    },
  ],
  variable: "--font-inter",
  display: "swap",
})
const mono = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-jetbrains",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: pwaName, template: `%s · ${pwaName}` },
  description: pwaDescription,
  applicationName: pwaName,
  // File-based app/manifest.ts also sets this. The <link> in the document
  // below is what carries crossorigin="use-credentials". Next only adds that
  // attribute when VERCEL_ENV=preview, which this server is not.
  manifest: pwaManifestPath,
  appleWebApp: {
    capable: true,
    title: pwaName,
    statusBarStyle: "black",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      ...pwaIcons
        .filter((icon) => icon.purpose === "any")
        .map((icon) => ({ url: icon.src, sizes: icon.sizes, type: icon.type })),
    ],
    apple: {
      url: pwaAppleTouchIcon.src,
      sizes: pwaAppleTouchIcon.sizes,
      type: pwaAppleTouchIcon.type,
    },
  },
  // appleWebApp.capable emits the standard tag. iOS Add to Home Screen still
  // reads the prefixed name when the manifest fetch is refused.
  other: { "apple-mobile-web-app-capable": "yes" },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: pwaThemeColorDark },
    { media: "(prefers-color-scheme: light)", color: pwaThemeColorLight },
  ],
}

// Everything is read from the local database at request time
export const dynamic = "force-dynamic"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(inter.variable, mono.variable)}
    >
      <head>
        {/* Browsers fetch the manifest with credentials omitted unless this
            attribute is set. Behind Caddy basic auth that is a 401, and the
            site is not installable. See docs/pwa.md. */}
        <link rel="manifest" href={pwaManifestPath} crossOrigin="use-credentials" />
      </head>
      {/* Browser extensions add attributes to <body> before React loads */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider delay={300}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
