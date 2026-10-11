"use server"

import {
  checkWorkstationNetwork,
  ensureWorkstation,
  getDesktopStreamUrl,
  getWorkstationStatus,
  resetWorkstation,
  stopWorkstation,
} from "@/lib/workstation"

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

export async function desktopStreamUrl(agentId: string) {
  return getDesktopStreamUrl(agentId)
}
