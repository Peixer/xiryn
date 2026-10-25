import fs from "node:fs"
import path from "node:path"

import { dutyWatches, noteDutyWatch, setDutyAllowed } from "@/lib/self-update/duty-gate"
import type { Colour } from "@/lib/self-update/state"

// Background work (Telegram, routines, the workstation janitor) follows the
// colour named in deploy state. A process with no colour of its own is a
// single install and always runs that work, except while the maintenance
// file is present. The switch writes the new active colour before it removes
// the maintenance file, so the two processes never both decide to run it.

export type ProcessRole =
  { kind: "solo" } | { kind: "colour"; colour: Colour } | { kind: "invalid" }

export type ActiveRead = Colour | "missing" | "unreadable"

export function processRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const named = env.XIRYN_COLOUR?.trim().toLowerCase()
  if (named === "blue" || named === "green") return { kind: "colour", colour: named }
  if (named) return { kind: "invalid" }
  const data = env.XIRYN_DATA_DIR?.replace(/\\/g, "/").replace(/\/+$/, "") ?? ""
  if (data.endsWith("/blue")) return { kind: "colour", colour: "blue" }
  if (data.endsWith("/green")) return { kind: "colour", colour: "green" }
  return { kind: "solo" }
}

export function workersWanted(
  input: { role: ProcessRole; active: ActiveRead; maintenance: boolean },
  previous: boolean
) {
  if (input.maintenance) return false
  if (input.role.kind === "invalid") return false
  if (input.role.kind === "solo") return true
  if (input.active === "missing") return false
  if (input.active === "unreadable") return previous
  return input.role.colour === input.active
}

export function readActiveColour(stateFile: string): ActiveRead {
  let text: string
  try {
    text = fs.readFileSync(stateFile, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" ? "missing" : "unreadable"
  }
  try {
    const parsed = JSON.parse(text) as { active?: unknown }
    if (parsed.active === "blue" || parsed.active === "green") return parsed.active
    return "unreadable"
  } catch {
    return "unreadable"
  }
}

export function maintenanceFilePresent(file: string) {
  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}

type LockOwner = { colour: Colour; beat: number }

function lockDir(dir: string) {
  return path.join(dir, "workers.lock")
}

function readLock(dir: string): LockOwner | null {
  const owner = path.join(lockDir(dir), "owner")
  try {
    const [colour, beatText] = fs.readFileSync(owner, "utf8").trim().split(" ")
    const beat = Number(beatText)
    if ((colour !== "blue" && colour !== "green") || !Number.isFinite(beat)) return null
    return { colour, beat }
  } catch {
    return null
  }
}

function writeLock(dir: string, colour: Colour, now: number) {
  fs.writeFileSync(path.join(lockDir(dir), "owner"), `${colour} ${now}\n`, {
    mode: 0o644,
  })
}

// Exclusive claim. The last process to mkdir the lock is the only one that
// may start work. A dead holder is replaced once its heartbeat is stale.
export function claimWorkers(dir: string, colour: Colour, staleMs: number, now: number) {
  const lock = lockDir(dir)
  const held = readLock(dir)
  if (held?.colour === colour) {
    try {
      writeLock(dir, colour, now)
      return true
    } catch {
      return false
    }
  }
  if (held && now - held.beat < staleMs) return false
  try {
    fs.rmSync(lock, { recursive: true, force: true })
    fs.mkdirSync(lock)
    writeLock(dir, colour, now)
  } catch {
    return false
  }
  return readLock(dir)?.colour === colour
}

export function releaseWorkers(dir: string, colour: Colour) {
  const held = readLock(dir)
  if (!held || held.colour !== colour) return
  fs.rmSync(lockDir(dir), { recursive: true, force: true })
}

export type DutyHandlers = {
  start(): void
  stop(): void
  // Maintenance began. Workers are already stopped. Freeze writes here.
  quiesce?(): void
  // Maintenance ended. Thaw writes before workers start again.
  resumeWrites?(): void
}

export type DutyOptions = {
  env?: NodeJS.ProcessEnv
  stateFile?: string
  maintenanceFile?: string
  intervalMs?: number
  staleMs?: number
  now?: () => number
}

const DEFAULT_STATE = "/var/lib/xiryn/deploy/state.json"
const DEFAULT_MAINTENANCE = "/etc/xiryn/maintenance"

function watchDir(file: string, onChange: () => void) {
  const dir = path.dirname(file)
  try {
    if (!fs.existsSync(dir)) return null
    return fs.watch(dir, () => onChange())
  } catch {
    return null
  }
}

export function followDuty(handlers: DutyHandlers, options: DutyOptions = {}) {
  const env = options.env ?? process.env
  const stateFile =
    options.stateFile ??
    (env.XIRYN_DEPLOY_DIR ? path.join(env.XIRYN_DEPLOY_DIR, "state.json") : DEFAULT_STATE)
  const maintenanceFile =
    options.maintenanceFile ?? env.XIRYN_MAINTENANCE_FILE ?? DEFAULT_MAINTENANCE
  const intervalMs = options.intervalMs ?? 250
  const staleMs = options.staleMs ?? 1_500
  const now = options.now ?? (() => Date.now())
  const role = processRole(env)
  const deployDir = path.dirname(stateFile)

  let running = false
  let previous = false
  let heldQuiesce = false
  let closed = false
  let ticking = false
  let again = false

  noteDutyWatch(true)

  const tick = () => {
    if (closed) return
    if (ticking) {
      again = true
      return
    }
    ticking = true
    try {
      const active = readActiveColour(stateFile)
      const maintenance = maintenanceFilePresent(maintenanceFile)
      const wanted = workersWanted({ role, active, maintenance }, previous)
      previous = wanted
      setDutyAllowed(wanted)

      if (maintenance) {
        if (running) {
          handlers.stop()
          running = false
          if (role.kind === "colour") releaseWorkers(deployDir, role.colour)
        }
        if (!heldQuiesce) {
          handlers.quiesce?.()
          heldQuiesce = true
        }
        return
      }

      if (heldQuiesce) {
        handlers.resumeWrites?.()
        heldQuiesce = false
      }

      if (!wanted) {
        if (running) {
          handlers.stop()
          running = false
          if (role.kind === "colour") releaseWorkers(deployDir, role.colour)
        }
        return
      }

      if (role.kind === "colour") {
        if (!claimWorkers(deployDir, role.colour, staleMs, now())) {
          if (running) {
            handlers.stop()
            running = false
          }
          return
        }
      }

      if (!running) {
        handlers.start()
        running = true
      }
    } finally {
      ticking = false
      if (again) {
        again = false
        tick()
      }
    }
  }

  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  const stateWatch = watchDir(stateFile, tick)
  const maintenanceWatch = watchDir(maintenanceFile, tick)

  return {
    close() {
      if (closed) return
      closed = true
      clearInterval(timer)
      stateWatch?.close()
      maintenanceWatch?.close()
      if (running) {
        try {
          handlers.stop()
        } catch {
          // The process is going away. The lock release below is the handoff.
        }
        running = false
      }
      if (heldQuiesce) {
        try {
          handlers.resumeWrites?.()
        } catch {
          // same as stop
        }
        heldQuiesce = false
      }
      if (role.kind === "colour") releaseWorkers(deployDir, role.colour)
      noteDutyWatch(false)
      if (dutyWatches() === 0) setDutyAllowed(true)
    },
  }
}
