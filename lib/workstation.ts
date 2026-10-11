import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk"
import { eq } from "drizzle-orm"

import { db } from "@/db"
import { agents } from "@/db/schema"
import { getSetting } from "@/lib/config"

// Each agent owns a Daytona sandbox: a Linux machine with a shell, a disk
// and a graphical desktop. Oryn calls it the agent's workstation. It is
// created the first time something needs it and kept for the agent's life.

export class WorkstationUnavailableError extends Error {
  name = "WorkstationUnavailableError"
  constructor() {
    super(
      "Workstations are off: add DAYTONA_API_KEY to .env or paste a key in Settings → Integrations."
    )
  }
}

export function isWorkstationConfigured() {
  return !!getSetting("daytona.apiKey")
}

let client: { key: string; daytona: Daytona } | null = null

function getDaytona() {
  const apiKey = getSetting("daytona.apiKey")
  if (!apiKey) throw new WorkstationUnavailableError()
  const apiUrl = getSetting("daytona.apiUrl")
  const target = getSetting("daytona.target")

  // Rebuilt when the key or endpoint changes in Settings
  const key = [apiKey, apiUrl, target].join("|")
  if (client?.key !== key) {
    client = { key, daytona: new Daytona({ apiKey, apiUrl, target }) }
  }
  return client.daytona
}

function minutesSetting(key: "daytona.autoStop" | "daytona.autoDelete") {
  const minutes = Number.parseInt(getSetting(key) ?? "", 10)
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : undefined
}

async function provision(agentId: string) {
  const daytona = getDaytona()
  const autoDelete = minutesSetting("daytona.autoDelete")
  const sandbox = await daytona.create({
    labels: { "oryn-agent": agentId },
    autoStopInterval: minutesSetting("daytona.autoStop") ?? 15,
    // Disposable machines: deleted this long after they stop. Memory is local
    // and survives; the next task simply gets a fresh workstation.
    ...(autoDelete !== undefined && { autoDeleteInterval: autoDelete }),
  })
  db.update(agents)
    .set({ workstationId: sandbox.id, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .run()
  return sandbox
}

async function wake(sandbox: Sandbox) {
  if (sandbox.state !== "started") await sandbox.start()
  return sandbox
}

// Concurrent tool calls for the same agent share one lookup or creation
const pending = new Map<string, Promise<Sandbox>>()

// A sandbox seen running recently is reused without asking Daytona again
const recent = new Map<string, { sandbox: Sandbox; at: number }>()
const RECENT_MS = 60_000

// The agent's workstation, running. Creates it on first use, and again if it
// was deleted from the Daytona dashboard.
export function ensureWorkstation(agentId: string): Promise<Sandbox> {
  const cached = recent.get(agentId)
  if (cached && Date.now() - cached.at < RECENT_MS) return Promise.resolve(cached.sandbox)
  const existing = pending.get(agentId)
  if (existing) return existing

  const task = (async () => {
    const agent = db
      .select({ workstationId: agents.workstationId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get()
    if (!agent) throw new Error("Agent not found")

    if (agent.workstationId) {
      try {
        return await wake(await getDaytona().get(agent.workstationId))
      } catch (error) {
        if (!(error instanceof DaytonaNotFoundError)) throw error
      }
    }
    return provision(agentId)
  })()
    .then((sandbox) => {
      recent.set(agentId, { sandbox, at: Date.now() })
      return sandbox
    })
    .finally(() => pending.delete(agentId))

  pending.set(agentId, task)
  return task
}

export async function ensureDesktop(agentId: string) {
  const sandbox = await ensureWorkstation(agentId)
  // computerUse.start() takes seconds even as a no-op; check the status first
  const { status } = await sandbox.computerUse.getStatus()
  if (status !== "active") await sandbox.computerUse.start()
  return sandbox
}

export type WorkstationStatus =
  | { state: "unconfigured" }
  | { state: "unprovisioned" }
  | { state: "missing" }
  | {
      state: string
      id: string
      cpu: number
      memory: number
      disk: number
      target: string
    }

// Looks without waking anything up
export async function getWorkstationStatus(agentId: string): Promise<WorkstationStatus> {
  if (!isWorkstationConfigured()) return { state: "unconfigured" }
  const agent = db
    .select({ workstationId: agents.workstationId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()
  if (!agent?.workstationId) return { state: "unprovisioned" }
  try {
    const sandbox = await getDaytona().get(agent.workstationId)
    return {
      state: sandbox.state ?? "unknown",
      id: sandbox.id,
      cpu: sandbox.cpu,
      memory: sandbox.memory,
      disk: sandbox.disk,
      target: sandbox.target,
    }
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) return { state: "missing" }
    throw error
  }
}

export async function stopWorkstation(agentId: string) {
  const agent = db
    .select({ workstationId: agents.workstationId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()
  if (!agent?.workstationId) return
  recent.delete(agentId)
  const sandbox = await getDaytona().get(agent.workstationId)
  if (sandbox.state === "started") await sandbox.stop()
}

export async function deleteWorkstationById(workstationId: string) {
  try {
    const daytona = getDaytona()
    await daytona.delete(await daytona.get(workstationId))
  } catch (error) {
    // Nothing to delete: the goal is already met
    if (error instanceof DaytonaNotFoundError) return
    throw error
  }
}

// Wipes the machine: the next use provisions a fresh one
export async function resetWorkstation(agentId: string) {
  recent.delete(agentId)
  const agent = db
    .select({ workstationId: agents.workstationId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()
  if (agent?.workstationId) await deleteWorkstationById(agent.workstationId)
  db.update(agents)
    .set({ workstationId: null, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .run()
}

// Daytona plans differ in egress: lower tiers only reach essential services
// (GitHub, package registries, AI APIs). Probe an ordinary site to tell.
export async function checkWorkstationNetwork(agentId: string) {
  const sandbox = await ensureWorkstation(agentId)
  const probe = (url: string) =>
    `$(curl -s -o /dev/null -m 6 -w '%{http_code}' ${url} || echo 000)`
  const result = await sandbox.process.executeCommand(
    `echo ${probe("https://example.com")} ${probe("https://github.com")}`,
    undefined,
    undefined,
    30
  )
  const [open, essential] = (result.result ?? "").trim().split(/\s+/)
  const reached = (code?: string) => !!code && !code.startsWith("000")
  return {
    internet: reached(open)
      ? ("full" as const)
      : reached(essential)
        ? ("restricted" as const)
        : ("offline" as const),
  }
}

// noVNC listens on this port inside the default Daytona image
const VNC_PORT = 6080

// A wss:// URL for the browser's VNC client. The signed preview link embeds
// a token that expires after an hour, so nothing else is needed to connect.
export async function getDesktopStreamUrl(agentId: string) {
  const sandbox = await ensureDesktop(agentId)
  const preview = await sandbox.getSignedPreviewUrl(VNC_PORT, 60 * 60)
  const url = new URL("/websockify", preview.url)
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
  return url.toString()
}

// Cheap check used by Settings: reads one page of sandboxes to prove the key
// works, and counts the ones that belong to Oryn
export async function pingDaytona() {
  let seen = 0
  let owned = 0
  for await (const sandbox of getDaytona().list()) {
    if (sandbox.labels?.["oryn-agent"]) owned++
    if (++seen >= 100) break
  }
  return { sandboxes: owned }
}
