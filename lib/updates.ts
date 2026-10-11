import fs from "node:fs"
import path from "node:path"

import { getSetting } from "@/lib/config"
import { REPOSITORY } from "@/lib/project"
import { version } from "@/package.json"

// Whether a newer Oryn is out, and how many stars the project has. The one
// request Oryn makes on its own: GitHub's public API, a few times a day,
// sending nothing about you. Off with ORYN_UPDATE_CHECK=off or in Settings.

const API = `https://api.github.com/repos/${REPOSITORY}`
const FRESH_MS = 6 * 60 * 60_000

export type UpdateInfo = {
  stars: number | null
  // How many commits main is ahead of this copy, when it's a git clone
  behind: number | null
  latestVersion: string | null
  available: boolean
}

const globalForUpdates = globalThis as unknown as {
  __orynUpdates?: { at: number; info: UpdateInfo } | null
  __orynUpdatesRunning?: Promise<void> | null
}

export function updateChecksEnabled() {
  return getSetting("updates.check") !== "off"
}

async function github<T>(route: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${API}${route}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "oryn",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  })
  return {
    status: response.status,
    body: response.ok ? ((await response.json()) as T) : null,
  }
}

// The commit this copy is on, read straight from .git (no git needed)
function localCommit() {
  try {
    const gitDir = path.join(/*turbopackIgnore: true*/ process.cwd(), ".git")
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim()
    if (!head.startsWith("ref: ")) return /^[0-9a-f]{40}$/.test(head) ? head : null
    const ref = head.slice(5)
    const loose = path.join(gitDir, ...ref.split("/"))
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim()
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8")
    return packed.match(new RegExp(`^([0-9a-f]{40}) ${ref}$`, "m"))?.[1] ?? null
  } catch {
    return null
  }
}

function newer(candidate: string, current: string) {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((n) => Number(n) || 0)
  const [a, b] = [parse(candidate), parse(current)]
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

async function check(): Promise<UpdateInfo> {
  const [repo, release] = await Promise.all([
    github<{ stargazers_count: number }>(""),
    github<{ tag_name: string }>("/releases/latest"),
  ])
  const latestVersion = release.body?.tag_name?.replace(/^v/, "") ?? null

  // A git clone compares commits, so anything pushed counts; other installs
  // compare the released version
  let behind: number | null = null
  const commit = localCommit()
  if (commit) {
    const compare = await github<{ status: string; ahead_by: number }>(
      `/compare/${commit}...main`
    )
    if (compare.body) {
      behind =
        compare.body.status === "ahead" || compare.body.status === "diverged"
          ? compare.body.ahead_by
          : 0
    }
  }

  return {
    stars: repo.body?.stargazers_count ?? null,
    behind,
    latestVersion,
    available:
      behind !== null ? behind > 0 : !!latestVersion && newer(latestVersion, version),
  }
}

// What was last learned, without waiting. Looks again in the background
// when it's older than a few hours.
export function getUpdateInfo(): UpdateInfo | null {
  if (!updateChecksEnabled()) return null
  const cached = globalForUpdates.__orynUpdates
  if (
    (!cached || Date.now() - cached.at > FRESH_MS) &&
    !globalForUpdates.__orynUpdatesRunning
  ) {
    globalForUpdates.__orynUpdatesRunning = check()
      .then((info) => {
        globalForUpdates.__orynUpdates = { at: Date.now(), info }
      })
      .catch(() => {
        // Offline or rate-limited: try again later, keep what we had
        globalForUpdates.__orynUpdates = {
          at: Date.now() - FRESH_MS + 15 * 60_000,
          info: cached?.info ?? {
            stars: null,
            behind: null,
            latestVersion: null,
            available: false,
          },
        }
      })
      .finally(() => {
        globalForUpdates.__orynUpdatesRunning = null
      })
  }
  return cached?.info ?? null
}
