import path from "node:path"

import { connect } from "@/db"
import { activeThreadIds } from "@/lib/agent/runtime"
import { routinesBusy } from "@/lib/routines"
import { processRole } from "@/lib/self-update/duty"
import { readMaintenanceToken, writeQuiesce } from "@/lib/self-update/quiesce"

export {
  quiescenceSatisfied,
  readMaintenanceToken,
  readQuiesce,
  waitForQuiescence,
  writeQuiesce,
  type QuiesceAck,
} from "@/lib/self-update/quiesce"

// Maintenance used to refuse only non-GET HTTP. Agent turns, routines, and
// Telegram write on the same connection without going through the proxy.
// query_only closes that connection. The helper also holds a reserved lock
// around the snapshot so a process that does not know about maintenance
// cannot commit while the copy is taken.

type PragmaDb = { pragma: (source: string) => unknown }

export function setWriteFrozen(sqlite: PragmaDb, frozen: boolean) {
  sqlite.pragma(`query_only = ${frozen ? "ON" : "OFF"}`)
}

let drainEpoch = 0

export function cancelWriteDrain() {
  drainEpoch++
}

export async function drainAndFreeze(input: {
  sqlite: PragmaDb
  busy: () => number
  ackFile: string
  colour: string
  token: string | null
  timeoutMs?: number
}) {
  const epoch = drainEpoch
  const deadline = Date.now() + (input.timeoutMs ?? 20_000)
  while (drainEpoch === epoch && Date.now() < deadline && input.busy() > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (drainEpoch !== epoch) return
  setWriteFrozen(input.sqlite, true)
  if (drainEpoch !== epoch) {
    setWriteFrozen(input.sqlite, false)
    return
  }
  writeQuiesce(input.ackFile, {
    colour: input.colour,
    token: input.token,
    queryOnly: true,
    workers: "stopped",
    activeRuns: input.busy(),
    at: Date.now(),
  })
}

export function resumeProcessWrites(sqlite: PragmaDb) {
  cancelWriteDrain()
  setWriteFrozen(sqlite, false)
}

// Called when the maintenance file appears. In-flight turns get a bounded
// chance to commit, then this connection rejects writes and tells the helper.
export function quiesceThisProcess() {
  const role = processRole()
  const colour = role.kind === "colour" ? role.colour : "solo"
  const deploy = process.env.XIRYN_DEPLOY_DIR || "/var/lib/xiryn/deploy"
  const token = readMaintenanceToken(
    process.env.XIRYN_MAINTENANCE_FILE || "/etc/xiryn/maintenance"
  )
  void drainAndFreeze({
    sqlite: connect().sqlite,
    busy: () => activeThreadIds().length + (routinesBusy() ? 1 : 0),
    ackFile: path.join(deploy, `quiesce-${colour}.json`),
    colour,
    token,
  }).catch((error) => {
    console.error("[xiryn] could not freeze writes:", error)
  })
}

export function resumeThisProcess() {
  resumeProcessWrites(connect().sqlite)
}
