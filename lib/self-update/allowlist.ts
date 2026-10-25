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

const SERVICE_NAME = /^[a-z_][a-z0-9_-]{0,31}$/

// The oneshot is root. Git, npm, and node that touch a colour tree or its
// database run as this user, so the files the service opens are not root-owned
// and npm install scripts are not root. Override only for tests.
export function serviceUserName() {
  const name = process.env.XIRYN_SERVICE_USER || "xiryn"
  if (!SERVICE_NAME.test(name) || name === "root") {
    throw new Error("The service user is not valid.")
  }
  return name
}

export function serviceArgv(user: string, argv: readonly string[]) {
  return [
    "setpriv",
    "--no-new-privs",
    "--reuid",
    user,
    "--regid",
    user,
    "--init-groups",
    "--inh-caps",
    "-all",
    "--bounding-set",
    "-all",
    "--",
    ...argv,
  ]
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

function uploadPack(layout: Layout) {
  return `git -c safe.directory=${layout.mirror} upload-pack`
}

function colourGitAllowed(rest: readonly string[], layout: Layout) {
  // A local clone or fetch runs upload-pack inside the mirror. That child does
  // not inherit -c, so the same safe.directory has to be on its command line
  // or git still reports dubious ownership.
  if (
    rest[0] === "-c" &&
    rest[1] === `safe.directory=${layout.mirror}` &&
    rest[2] === "clone" &&
    rest[3] === "--no-checkout" &&
    rest[4] === "--upload-pack" &&
    rest[5] === uploadPack(layout) &&
    rest[6] === layout.mirror &&
    rest.length === 8 &&
    isColourDir(layout, rest[7])
  ) {
    return true
  }
  if (rest[0] !== "-C" || !isColourDir(layout, rest[1] ?? "")) return false
  if (
    rest[2] === "-c" &&
    rest[3] === `safe.directory=${layout.mirror}` &&
    rest[4] === "fetch" &&
    rest[5] === "--upload-pack" &&
    rest[6] === uploadPack(layout) &&
    rest[7] === layout.mirror &&
    rest[8] === `+refs/heads/${layout.branch}:refs/remotes/pin/${layout.branch}` &&
    rest.length === 9
  ) {
    return true
  }
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
  return rest[2] === "rev-parse" && rest[3] === "HEAD" && rest.length === 4
}

// One directory under deploy/staging, the name the helper builds from a
// timestamp. The service user can write there. /var/backups/xiryn stays root.
function isServiceStaging(layout: Layout, dir: string) {
  const root = `${layout.deployDir}/staging/`
  if (!dir.startsWith(root) || dir.includes("..")) return false
  const name = dir.slice(root.length)
  return name.length > 0 && /^[A-Za-z0-9._+-]+$/.test(name)
}

function nodeAllowed(rest: readonly string[], layout: Layout) {
  if (rest[0]?.endsWith("/self-update-snapshot.mjs") && rest[1] === "--from") {
    const to = rest[4] ?? ""
    return (
      rest.length === 5 &&
      rest[3] === "--to" &&
      isColourData(layout, rest[2]) &&
      (isColourData(layout, to) || isServiceStaging(layout, to))
    )
  }
  if (rest[0]?.endsWith("/self-update-approval.mjs") && rest[1] === "--db") {
    const db = rest[2] ?? ""
    const known =
      db === `${layout.blueData}/xiryn.db` || db === `${layout.greenData}/xiryn.db`
    const idOk = /^[A-Za-z0-9_-]{8,32}$/.test(rest[4] ?? "")
    if (!known || rest[3] !== "--id" || !idOk) return false
    if (rest.length === 5) return true
    return rest.length === 6 && rest[5] === "--consume"
  }
  if (rest[0]?.endsWith("/self-update-migrate.mjs") && rest[1] === "--data") {
    return (
      rest.length === 5 &&
      rest[3] === "--migrations" &&
      isColourData(layout, rest[2]) &&
      rest[4].endsWith("/db/migrations") &&
      isColourDir(layout, rest[4].slice(0, -"/db/migrations".length))
    )
  }
  return false
}

// Git, npm, and node against a colour. These must already be wrapped by
// serviceArgv. Mirror fetch, systemctl, caddy, and the health check stay root.
function serviceInnerAllowed(rest: readonly string[], layout: Layout) {
  const [bin, ...args] = rest
  if (bin === "git") return colourGitAllowed(args, layout)
  if (
    bin === "npm" &&
    args[0] === "--prefix" &&
    isColourDir(layout, args[1] ?? "") &&
    (same(args.slice(2), ["ci", "--include=dev", "--no-audit", "--no-fund"]) ||
      same(args.slice(2), ["run", "build"]))
  ) {
    return true
  }
  return bin === "node" && nodeAllowed(args, layout)
}

function wrappedServiceAllowed(argv: readonly string[], layout: Layout, user: string) {
  const prefix = serviceArgv(user, [])
  if (argv.length <= prefix.length) return false
  if (!prefix.every((part, index) => argv[index] === part)) return false
  return serviceInnerAllowed(argv.slice(prefix.length), layout)
}

// Every process the helper may spawn. Anything else, including a shell,
// sudo, or a systemctl unit the layout did not name, is refused.
// `user` is the account colour commands drop to. It is not taken from the
// request file.
export function commandAllowed(argv: readonly string[], layout: Layout, user = "xiryn") {
  if (argv.some((part) => part.includes("\0") || part.includes("\n"))) return false
  if (!SERVICE_NAME.test(user) || user === "root") return false
  if (argv[0] === "setpriv") return wrappedServiceAllowed(argv, layout, user)
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
  if (bin === "git" || bin === "npm" || bin === "node" || bin === "/usr/bin/node") {
    // The write lock stays root. Dropping to the service user would let
    // that user kill it. Only system node and the root-owned script are
    // accepted, so a `node` earlier on PATH cannot be substituted.
    if (
      bin === "/usr/bin/node" &&
      rest[0] === "/usr/local/lib/xiryn/self-update-lock.mjs" &&
      rest[1] === "--db" &&
      rest.length === 3
    ) {
      const db = rest[2]
      return db === `${layout.blueData}/xiryn.db` || db === `${layout.greenData}/xiryn.db`
    }
    return false
  }
  if (
    bin === "systemctl" &&
    ["start", "stop", "is-active", "enable", "disable"].includes(rest[0]) &&
    rest.length === 2
  ) {
    return rest[1] === colourUnit("blue") || rest[1] === colourUnit("green")
  }
  if (bin === "caddy" && same(rest, ["reload", "--config", layout.caddyfile])) return true
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
