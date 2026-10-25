import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { docker, dockerRaw, ensureEngine } from "@/lib/docker"

// Agents' machines run from an image built on this computer out of the
// ./workstation folder. Its tag is a fingerprint of that folder, so after an
// update that changes it Xiryn builds the new image once, and each agent moves
// to it the next time its machine starts. Files in a home folder are kept.

export const IMAGE_REPO = "xiryn-workstation"

// buildx writes activity, instance, and history files under ~/.docker/buildx
// unless this is set. The colour units point it at a directory outside the
// home directory, because ProtectHome=read-only makes ~/.docker read-only.
export const BUILDX_STATE_DIR = "/var/lib/xiryn/docker/buildx"

export function describeWorkstationBuildFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  const homeBlocked =
    /read-only file system|\bEROFS\b/i.test(detail) || /\.docker\/buildx\//.test(detail)
  const next = homeBlocked
    ? `Buildx tried to write under the service user's home, which ProtectHome keeps read-only. Set BUILDX_CONFIG=${BUILDX_STATE_DIR}, create that directory mode 0700 owned by the service user, and list it on ReadWritePaths. The blue/green installer does this. Then remove /etc/systemd/system/xiryn-blue.service.d/20-docker-config.conf and the green copy, and reload systemd.`
    : "Rebuild it from Settings → Workstations. An agent desktop is created only after the image exists."
  return `The workstation image did not build. Pages and other features keep serving. ${next} (${detail})`
}

export function logWorkstationBuildFailure(error: unknown): void {
  console.error(`[xiryn] ${describeWorkstationBuildFailure(error)}`)
}

// Startup and Settings start a build and continue. The rejection is logged
// inside buildImage; swallowing it here is what keeps a failed build off the
// process and off page loads.
export function observeWorkstationBuild(build: Promise<string>): Promise<void> {
  return build.then(
    () => undefined,
    () => undefined
  )
}

const SOURCE = path.join(/*turbopackIgnore: true*/ process.cwd(), "workstation")
const LOG_LINES = 80

// Every file under dir, as forward-slash paths relative to it
function sourceFiles(dir: string, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory()
      ? sourceFiles(path.join(dir, entry.name), relative)
      : [relative]
  })
}

// Kept in step with fingerprint() in scripts/setup.mjs
function fingerprint() {
  const hash = createHash("sha256")
  for (const file of sourceFiles(SOURCE).sort()) {
    hash.update(file)
    hash.update("\0")
    hash.update(fs.readFileSync(path.join(SOURCE, ...file.split("/"))))
    hash.update("\0")
  }
  return hash.digest("hex").slice(0, 12)
}

let cachedTag: { at: number; tag: string } | null = null

export function imageTag() {
  if (!cachedTag || Date.now() - cachedTag.at > 10_000) {
    cachedTag = { at: Date.now(), tag: `${IMAGE_REPO}:${fingerprint()}` }
  }
  return cachedTag.tag
}

export type ImageState =
  | { state: "absent"; tag: string }
  | {
      state: "building"
      tag: string
      step: string | null
      log: string[]
      startedAt: number
    }
  | { state: "ready"; tag: string; sizeBytes: number }
  | { state: "failed"; tag: string; error: string; log: string[] }

const globalForImage = globalThis as unknown as {
  __xirynImage?: { build: Promise<string> | null; last: ImageState | null }
}
const shared = (globalForImage.__xirynImage ??= { build: null, last: null })

export async function getImageState(): Promise<ImageState> {
  const tag = imageTag()
  const last = shared.last
  if (last?.tag === tag && last.state === "building") return last
  const { exitCode, stdout } = await dockerRaw(
    ["image", "inspect", tag, "--format", "{{.Size}}"],
    { timeoutMs: 15_000 }
  )
  if (exitCode === 0) {
    return { state: "ready", tag, sizeBytes: Number(stdout.toString().trim()) || 0 }
  }
  if (last?.tag === tag && last.state === "failed") return last
  return { state: "absent", tag }
}

// Builds the image unless a build is already running. Resolves with its tag.
export function buildImage(): Promise<string> {
  if (shared.build) return shared.build
  const tag = imageTag()
  const status: ImageState & { state: "building" } = {
    state: "building",
    tag,
    step: null,
    log: [],
    startedAt: Date.now(),
  }
  shared.last = status

  shared.build = (async () => {
    await ensureEngine()
    try {
      await docker(
        ["build", "--tag", tag, "--label", "xiryn.workstation-image=1", SOURCE],
        {
          timeoutMs: 45 * 60_000,
          env: { BUILDKIT_PROGRESS: "plain", DOCKER_CLI_HINTS: "false" },
          onLine: (line) => {
            status.log.push(line)
            if (status.log.length > LOG_LINES) status.log.shift()
            // BuildKit: "#7 [3/9] RUN apt-get update …"
            const step = line.match(/^#\d+ \[(?:\S+ )?(\d+\/\d+)\] (.+)$/)
            if (step) status.step = `${step[1]} · ${step[2].slice(0, 90)}`
          },
        }
      )
    } catch (error) {
      shared.last = {
        state: "failed",
        tag,
        error: describeWorkstationBuildFailure(error),
        log: status.log,
      }
      logWorkstationBuildFailure(error)
      throw error
    }
    shared.last = null
    await pruneOldImages(tag)
    return tag
  })().finally(() => {
    shared.build = null
  })
  return shared.build
}

// The image agents should run, built first if it isn't there yet
export async function ensureImage() {
  const state = await getImageState()
  if (state.state === "ready") return state.tag
  return buildImage()
}

// Earlier versions are removed once nothing uses them
async function pruneOldImages(current: string) {
  const { stdout } = await dockerRaw(["images", IMAGE_REPO, "--format", "{{.Tag}}"])
  for (const tag of stdout.toString().split(/\r?\n/).filter(Boolean)) {
    const name = `${IMAGE_REPO}:${tag}`
    if (name !== current) await dockerRaw(["rmi", name])
  }
}
