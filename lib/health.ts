import { asc, eq } from "drizzle-orm"

import { db, sqlite } from "@/db"
import { routines } from "@/db/schema"
import { getSetting } from "@/lib/config"
import { DockerMissingError, dockerRaw } from "@/lib/docker"
import { configuredProviders } from "@/lib/providers/registry"
import { version } from "@/package.json"

// A hung daemon must not hold the check. The handler itself stays under a second.
const DOCKER_PROBE_MS = 800

export const DOCKER_STATES = ["ready", "stopped", "missing", "unknown"] as const

export type DockerHealth = (typeof DOCKER_STATES)[number]

export type HealthSnapshot = {
  version: string
  uptimeSeconds: number
  dbOk: boolean
  docker: DockerHealth
  // `enabled` is how many routines are switched on. `nextRunAt` is the soonest of those.
  routines: { enabled: number; nextRunAt: Date | null }
  telegramConfigured: boolean
  providersConfigured: number
}

export type HealthBody = {
  status: "ok" | "degraded" | "down"
  version: string
  uptimeSeconds: number
  db: { ok: boolean }
  docker: DockerHealth
  routines: { enabled: number; nextRunAt: string | null }
  telegram: "off" | "configured"
  providersConfigured: number
}

export type HealthReport = {
  httpStatus: 200 | 503
  body: HealthBody
}

function normalizeDocker(value: string): DockerHealth {
  switch (value) {
    case "ready":
    case "stopped":
    case "missing":
    case "unknown":
      return value
    default:
      return "unknown"
  }
}

function nextRunAt(value: Date | null): string | null {
  if (!(value instanceof Date)) return null
  const time = value.getTime()
  if (!Number.isFinite(time)) return null
  return new Date(time).toISOString()
}

function count(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

// Pure: the route and the tests both go through here, so a snapshot can never
// grow a secret, a path, or a thread into the JSON.
export function buildHealth(snapshot: HealthSnapshot): HealthReport {
  const docker = normalizeDocker(snapshot.docker)
  const dbOk = snapshot.dbOk === true
  const status = !dbOk ? "down" : docker === "ready" ? "ok" : "degraded"
  const routines = snapshot.routines ?? { enabled: 0, nextRunAt: null }
  return {
    httpStatus: status === "down" ? 503 : 200,
    body: {
      status,
      version: typeof snapshot.version === "string" ? snapshot.version : "",
      uptimeSeconds: count(snapshot.uptimeSeconds),
      db: { ok: dbOk },
      docker,
      routines: {
        enabled: count(routines.enabled),
        nextRunAt: nextRunAt(routines.nextRunAt),
      },
      telegram: snapshot.telegramConfigured ? "configured" : "off",
      providersConfigured: count(snapshot.providersConfigured),
    },
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function probeDocker(): Promise<DockerHealth> {
  try {
    const outcome = await withDeadline(
      dockerRaw(["info", "--format", "{{.ServerVersion}}"], {
        timeoutMs: DOCKER_PROBE_MS,
      }),
      DOCKER_PROBE_MS + 150
    )
    if (outcome === "timeout") return "unknown"
    if (outcome.exitCode === null) return "unknown"
    const reported = outcome.stdout.toString("utf8").trim()
    if (outcome.exitCode === 0 && reported) return "ready"
    return "stopped"
  } catch (error) {
    if (error instanceof DockerMissingError) return "missing"
    return "unknown"
  }
}

function pingDb() {
  try {
    const row = sqlite.prepare("select 1 as ok").get() as { ok?: number } | undefined
    return row?.ok === 1
  } catch {
    return false
  }
}

function readRoutines(): HealthSnapshot["routines"] {
  try {
    const rows = db
      .select({ nextRunAt: routines.nextRunAt })
      .from(routines)
      .where(eq(routines.enabled, true))
      .orderBy(asc(routines.nextRunAt))
      .all()
    return {
      enabled: rows.length,
      nextRunAt: rows.find((row) => row.nextRunAt)?.nextRunAt ?? null,
    }
  } catch {
    return { enabled: 0, nextRunAt: null }
  }
}

function readTelegram() {
  try {
    // Presence only. The token itself never leaves this function.
    return Boolean(getSetting("telegram.botToken"))
  } catch {
    return false
  }
}

function readProviders() {
  try {
    return configuredProviders().length
  } catch {
    return 0
  }
}

export async function collectSnapshot(): Promise<HealthSnapshot> {
  const dockerPromise = probeDocker()
  try {
    const dbOk = pingDb()
    const docker = await dockerPromise
    return {
      version,
      uptimeSeconds: count(process.uptime()),
      dbOk,
      docker,
      routines: dbOk ? readRoutines() : { enabled: 0, nextRunAt: null },
      telegramConfigured: dbOk ? readTelegram() : false,
      providersConfigured: dbOk ? readProviders() : 0,
    }
  } catch {
    const docker = await dockerPromise.catch(() => "unknown" as const)
    return {
      version,
      uptimeSeconds: count(process.uptime()),
      dbOk: false,
      docker,
      routines: { enabled: 0, nextRunAt: null },
      telegramConfigured: false,
      providersConfigured: 0,
    }
  }
}
