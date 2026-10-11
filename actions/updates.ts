"use server"

import { latestUpdateInfo } from "@/lib/updates"

// Asked by the sidebar once each time the page loads
export async function checkForUpdates() {
  return latestUpdateInfo()
}
