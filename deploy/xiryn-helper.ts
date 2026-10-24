import fs from "node:fs"
import path from "node:path"

import { parseHelperRequest } from "@/lib/self-update/allowlist"
import { runPrepare, runRollback, runStatus, runSwitch } from "@/lib/self-update/helper"
import { createSystemHost, loadLayout } from "@/lib/self-update/system-host"

// Invoked by xiryn-deploy.service with no arguments. The operation is the
// JSON file the app wrote. A shell argument is refused.
if (process.argv.length !== 2) {
  process.stderr.write("xiryn-helper takes no arguments\n")
  process.exit(2)
}

const layout = loadLayout()
const dir = process.env.XIRYN_DEPLOY_DIR || layout.deployDir
const inbox = path.join(dir, "inbox")
const lockPath = path.join(dir, "helper.lock")
fs.mkdirSync(inbox, { recursive: true, mode: 0o700 })

let lock: number
try {
  lock = fs.openSync(lockPath, "wx", 0o600)
} catch {
  process.exit(0)
}

try {
  const names = fs
    .readdirSync(inbox)
    .filter((name) => /^\d+-(prepare|switch|rollback|status)\.json$/.test(name))
    .sort()
  const host = createSystemHost(layout)
  for (const name of names) {
    const file = path.join(inbox, name)
    let parsed: ReturnType<typeof parseHelperRequest>
    try {
      parsed = parseHelperRequest(JSON.parse(fs.readFileSync(file, "utf8")))
    } catch {
      parsed = { ok: false, reason: "The request is not JSON." }
    }
    fs.rmSync(file, { force: true })
    if (!parsed.ok) {
      host.audit({
        op: "status",
        result: "refused",
        actor: "helper",
        sha: null,
        active: host.readState().active,
        candidate: null,
        error: parsed.reason,
      })
      host.progress("refused", parsed.reason)
      continue
    }
    if (parsed.request.op === "prepare") runPrepare(host, parsed.request)
    else if (parsed.request.op === "switch") runSwitch(host, parsed.request)
    else if (parsed.request.op === "rollback") runRollback(host, parsed.request)
    else runStatus(host)
  }
} finally {
  fs.closeSync(lock)
  fs.rmSync(lockPath, { force: true })
}
