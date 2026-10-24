import { isSha } from "@/lib/self-update/sha"
import {
  colourData,
  colourDir,
  colourPort,
  colourUnit,
  type Layout,
} from "@/lib/self-update/layout"
import type { Colour } from "@/lib/self-update/state"

// The privileged helper accepts only these operations. The app writes one
// of them into the inbox. It cannot pass a shell command, a path, or a ref.
export const HELPER_OPS = ["prepare", "switch", "rollback", "status"] as const

export type HelperOp = (typeof HELPER_OPS)[number]

export type HelperRequest = {
  op: HelperOp
  sha: string | null
  approvalId: string | null
  actor: "owner" | "agent"
  requestedAt: string
}

const KEYS = new Set(["op", "sha", "approvalId", "actor", "requestedAt"])
const ID = /^[A-Za-z0-9_-]{8,32}$/
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

function fail(reason: string) {
  return { ok: false as const, reason }
}

export function parseHelperRequest(
  value: unknown
): { ok: true; request: HelperRequest } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("The request is not an object.")
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!KEYS.has(key)) return fail("The request has a field the helper does not accept.")
  }
  const op = record.op
  if (typeof op !== "string" || !HELPER_OPS.includes(op as HelperOp)) {
    return fail("The operation is not in the helper allow-list.")
  }
  const actor = record.actor
  if (actor !== "owner" && actor !== "agent")
    return fail("The actor is not owner or agent.")
  const requestedAt = record.requestedAt
  if (typeof requestedAt !== "string" || !WHEN.test(requestedAt)) {
    return fail("The request time is not UTC.")
  }
  const sha = record.sha
  const approvalId = record.approvalId
  if (sha !== null && sha !== undefined && (typeof sha !== "string" || !isSha(sha))) {
    return fail("The target must be a 40-character lowercase commit.")
  }
  if (
    approvalId !== null &&
    approvalId !== undefined &&
    (typeof approvalId !== "string" || !ID.test(approvalId))
  ) {
    return fail("The approval id is not valid.")
  }
  if (op === "prepare" || op === "switch" || op === "rollback") {
    if (typeof sha !== "string") return fail("This operation needs a commit.")
  }
  if ((op === "switch" || op === "rollback") && typeof approvalId !== "string") {
    return fail("Switch and roll back need an approval id.")
  }
  if (op === "prepare" && actor === "agent" && typeof approvalId !== "string") {
    return fail("An agent update needs an approval id.")
  }
  if (op === "status" && (sha || approvalId)) {
    return fail("Status takes no commit and no approval.")
  }
  return {
    ok: true,
    request: {
      op: op as HelperOp,
      sha: typeof sha === "string" ? sha : null,
      approvalId: typeof approvalId === "string" ? approvalId : null,
      actor,
      requestedAt,
    },
  }
}

function same(argv: readonly string[], expected: readonly string[]) {
  return (
    argv.length === expected.length &&
    argv.every((part, index) => part === expected[index])
  )
}

function isColourDir(layout: Layout, dir: string) {
  return dir === layout.blueDir || dir === layout.greenDir
}

function isColourData(layout: Layout, dir: string) {
  return dir === layout.blueData || dir === layout.greenData
}

function range(value: string) {
  const [from, to] = value.split("..")
  return Boolean(from && to && isSha(from) && isSha(to) && value === `${from}..${to}`)
}

// Every process the helper may spawn. Anything else, including a shell,
// sudo, or a systemctl unit the layout did not name, is refused.
export function commandAllowed(argv: readonly string[], layout: Layout) {
  if (argv.some((part) => part.includes("\0") || part.includes("\n"))) return false
  const [bin, ...rest] = argv
  if (bin === "git" && rest[0] === "--git-dir" && rest[1] === layout.mirror) {
    if (
      same(rest.slice(2), [
        "fetch",
        "--prune",
        "origin",
        `+refs/heads/${layout.branch}:refs/heads/${layout.branch}`,
      ])
    ) {
      return true
    }
    if (same(rest.slice(2), ["rev-parse", `refs/heads/${layout.branch}`])) return true
    if (
      rest[2] === "log" &&
      rest[3] === "--format=%H%x09%s" &&
      rest.length === 5 &&
      range(rest[4])
    ) {
      return true
    }
    if (
      rest[2] === "diff" &&
      rest[3] === "--name-only" &&
      rest.length === 8 &&
      isSha(rest[4]) &&
      isSha(rest[5]) &&
      rest[6] === "--" &&
      rest[7] === "db/migrations"
    ) {
      return true
    }
    return false
  }
  if (
    bin === "git" &&
    rest[0] === "clone" &&
    rest[1] === "--no-checkout" &&
    rest[2] === layout.mirror
  ) {
    return rest.length === 4 && isColourDir(layout, rest[3])
  }
  if (bin === "git" && rest[0] === "-C" && isColourDir(layout, rest[1] ?? "")) {
    if (
      rest[2] === "checkout" &&
      rest[3] === "--detach" &&
      rest.length === 5 &&
      isSha(rest[4])
    ) {
      return true
    }
    if (
      rest[2] === "log" &&
      rest[3] === "--format=%H%x09%s" &&
      rest.length === 5 &&
      range(rest[4])
    ) {
      return true
    }
    if (
      rest[2] === "diff" &&
      rest[3] === "--name-only" &&
      rest.length === 8 &&
      isSha(rest[4]) &&
      isSha(rest[5]) &&
      rest[6] === "--" &&
      rest[7] === "db/migrations"
    ) {
      return true
    }
    if (rest[2] === "rev-parse" && rest[3] === "HEAD" && rest.length === 4) return true
    return false
  }
  if (
    bin === "npm" &&
    rest[0] === "--prefix" &&
    isColourDir(layout, rest[1] ?? "") &&
    (same(rest.slice(2), ["ci", "--no-audit", "--no-fund"]) ||
      same(rest.slice(2), ["run", "build"]))
  ) {
    return true
  }
  if (
    bin === "systemctl" &&
    (rest[0] === "start" || rest[0] === "stop" || rest[0] === "is-active") &&
    rest.length === 2
  ) {
    return rest[1] === colourUnit("blue") || rest[1] === colourUnit("green")
  }
  if (bin === "caddy" && same(rest, ["reload", "--config", layout.caddyfile])) return true
  if (
    bin === "node" &&
    rest[0]?.endsWith("/self-update-snapshot.mjs") &&
    rest[1] === "--from"
  ) {
    const to = rest[4] ?? ""
    const backup = to.startsWith(`${layout.backupDir}/`) && !to.includes("..")
    return (
      rest.length === 5 &&
      rest[3] === "--to" &&
      isColourData(layout, rest[2]) &&
      (isColourData(layout, to) || backup)
    )
  }
  if (
    bin === "node" &&
    rest[0]?.endsWith("/self-update-approval.mjs") &&
    rest[1] === "--db"
  ) {
    const db = rest[2] ?? ""
    const known =
      db === `${layout.blueData}/xiryn.db` || db === `${layout.greenData}/xiryn.db`
    return (
      rest.length === 5 &&
      rest[3] === "--id" &&
      known &&
      /^[A-Za-z0-9_-]{8,32}$/.test(rest[4] ?? "")
    )
  }
  if (
    bin === "node" &&
    rest[0]?.endsWith("/self-update-migrate.mjs") &&
    rest[1] === "--data"
  ) {
    return (
      rest.length === 5 &&
      rest[3] === "--migrations" &&
      isColourData(layout, rest[2]) &&
      rest[4].endsWith("/db/migrations") &&
      isColourDir(layout, rest[4].slice(0, -"/db/migrations".length))
    )
  }
  if (
    bin === "curl" &&
    rest[0] === "-fsS" &&
    rest[1] === "--max-time" &&
    rest[2] === "8"
  ) {
    if (rest[3] !== "-H" || rest[4] !== "Host: 127.0.0.1" || rest.length !== 6)
      return false
    return (
      rest[5] === `http://127.0.0.1:${layout.bluePort}/api/health` ||
      rest[5] === `http://127.0.0.1:${layout.greenPort}/api/health`
    )
  }
  return false
}

export function healthUrl(layout: Layout, colour: Colour) {
  return `http://127.0.0.1:${colourPort(layout, colour)}/api/health`
}

export function snapshotArgs(layout: Layout, script: string, from: Colour, to: Colour) {
  return [
    "node",
    script,
    "--from",
    colourData(layout, from),
    "--to",
    colourData(layout, to),
  ] as const
}

export function migrateArgs(layout: Layout, script: string, colour: Colour) {
  return [
    "node",
    script,
    "--data",
    colourData(layout, colour),
    "--migrations",
    `${colourDir(layout, colour)}/db/migrations`,
  ] as const
}
