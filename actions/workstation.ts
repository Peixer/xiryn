"use server"

import { revalidatePath } from "next/cache"

import { ensureEngine, probeEngine } from "@/lib/docker"
import {
  checkWorkstationNetwork,
  ensureWorkstation,
  getDesktopAccess,
  getWorkstationStatus,
  resetWorkstation,
  stopWorkstation,
} from "@/lib/workstation"
import { buildImage, getImageState } from "@/lib/workstation-image"

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function workstationStatus(agentId: string) {
  try {
    return { ok: true as const, status: await getWorkstationStatus(agentId) }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

export async function bootWorkstation(agentId: string) {
  await ensureWorkstation(agentId)
  return getWorkstationStatus(agentId)
}

export async function haltWorkstation(agentId: string) {
  await stopWorkstation(agentId)
  return getWorkstationStatus(agentId)
}

export async function wipeWorkstation(agentId: string) {
  await resetWorkstation(agentId)
  return getWorkstationStatus(agentId)
}

export async function workstationNetwork(agentId: string) {
  try {
    return { ok: true as const, ...(await checkWorkstationNetwork(agentId)) }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

// Where the desktop viewer connects, and the desktop's password
export async function desktopAccess(agentId: string) {
  return getDesktopAccess(agentId)
}

/* Docker and the workstation image, for Settings */

export async function dockerStatus() {
  const engine = await probeEngine()
  const image = engine.state === "ready" ? await getImageState() : null
  return { engine, image, platform: process.platform }
}

export async function startDocker() {
  try {
    await ensureEngine()
    revalidatePath("/", "layout")
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: reason(error) }
  }
}

// Starts a build and returns right away; progress comes from dockerStatus()
export async function buildWorkstationImage() {
  buildImage().catch((error) =>
    console.error("[oryn] workstation image build failed:", error)
  )
  return dockerStatus()
}
