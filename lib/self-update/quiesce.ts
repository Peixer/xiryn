import fs from "node:fs"
import path from "node:path"

// File-only half of the snapshot freeze. The root helper imports this.
// It must not import the database. The helper bundle would otherwise load
// the native driver from a path the service user can change.

export type QuiesceAck = {
  colour: string
  token: string | null
  queryOnly: boolean
  workers: "stopped"
  activeRuns: number
  at: number
}

export function readMaintenanceToken(file: string) {
  try {
    const token = fs.readFileSync(file, "utf8").split("\n")[1]?.trim() ?? ""
    return token || null
  } catch {
    return null
  }
}

export function writeQuiesce(file: string, ack: QuiesceAck) {
  const dir = path.dirname(file)
  try {
    if (!fs.existsSync(dir)) return
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
    fs.writeFileSync(tmp, `${JSON.stringify(ack)}\n`, { mode: 0o644 })
    fs.renameSync(tmp, file)
  } catch {
    // The helper still takes the database lock when this ack never arrives.
  }
}

export function readQuiesce(file: string): QuiesceAck | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<QuiesceAck>
    if (parsed.queryOnly !== true || parsed.workers !== "stopped") return null
    if (typeof parsed.at !== "number") return null
    if (typeof parsed.activeRuns !== "number") return null
    return {
      colour: typeof parsed.colour === "string" ? parsed.colour : "",
      token: typeof parsed.token === "string" ? parsed.token : null,
      queryOnly: true,
      workers: "stopped",
      activeRuns: parsed.activeRuns,
      at: parsed.at,
    }
  } catch {
    return null
  }
}

export function quiescenceSatisfied(ack: QuiesceAck | null, token: string | null) {
  if (!ack || ack.activeRuns !== 0) return false
  if (token && ack.token !== token) return false
  return true
}

export function waitForQuiescence(options: {
  acks: Array<{ file: string; token: string | null }>
  timeoutMs: number
  sleep: (ms: number) => void
  now: () => number
}) {
  const deadline = options.now() + options.timeoutMs
  for (;;) {
    const ready = options.acks.every((item) =>
      quiescenceSatisfied(readQuiesce(item.file), item.token)
    )
    if (ready) return true
    if (options.now() >= deadline) return false
    options.sleep(50)
  }
}
