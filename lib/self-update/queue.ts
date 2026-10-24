import fs from "node:fs"
import path from "node:path"

import type { HelperRequest } from "@/lib/self-update/allowlist"

export function enqueueRequest(deployDir: string, request: HelperRequest) {
  const inbox = path.join(deployDir, "inbox")
  fs.mkdirSync(inbox, { recursive: true, mode: 0o700 })
  const name = `${Date.parse(request.requestedAt)}-${request.op}.json`
  if (!/^\d+-(prepare|switch|rollback|status)\.json$/.test(name)) {
    throw new Error("Refusing to write a request with that name.")
  }
  const dest = path.join(inbox, name)
  const tmp = path.join(inbox, `.${name}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify(request)}\n`, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, dest)
  fs.chmodSync(dest, 0o600)
  return dest
}
