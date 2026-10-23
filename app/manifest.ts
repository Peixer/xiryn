import type { MetadataRoute } from "next"

import { webAppManifest } from "@/lib/pwa"

export default function manifest(): MetadataRoute.Manifest {
  return webAppManifest()
}
