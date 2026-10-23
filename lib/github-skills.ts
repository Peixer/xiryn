import {
  SKILL_MAX_BYTES,
  SKILL_MAX_COUNT,
  SkillError,
  type SkillImportResult,
  assertSkillSlug,
  listSkills,
  normalizeSlug,
  parseSkillMarkdown,
  serializeSkill,
  writeSkill,
} from "@/lib/skills"

// Reads SKILL.md files from a public GitHub folder the person pasted.
// The link never chooses the host: only api.github.com and
// raw.githubusercontent.com are requested, redirects are refused, and nothing
// from the response is used as the next URL. File text is untrusted prompt
// data. It is shown before it is saved, and it is not executed.

const API_HOST = "api.github.com"
const RAW_HOST = "raw.githubusercontent.com"
const API_MAX_BYTES = 2 * 1024 * 1024
const MAX_API_CALLS = 20
const MAX_URL_SEGMENTS = 16
const MAX_REF_CANDIDATES = 6
const MAX_WALK = 10
const REQUEST_TIMEOUT_MS = 8_000
const DEADLINE_MS = 20_000
const DOWNLOAD_CONCURRENCY = 6

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/
const SHA_RE = /^[0-9a-f]{40}$/

export type GithubAsset = {
  status: number
  body: string
  tooLarge: boolean
  rateRemaining: string | null
}

export type GithubFetch = (url: string, kind: "api" | "raw") => Promise<GithubAsset>

export type GithubSkillWarning = {
  path: string
  message: string
}

export type GithubPreviewSkill = {
  slug: string
  name: string
  description: string
  body: string
  path: string
  replaced: boolean
  canSave: boolean
}

export type GithubSkillsPreview = {
  owner: string
  repo: string
  ref: string
  path: string
  label: string
  htmlUrl: string
  skills: GithubPreviewSkill[]
  warnings: GithubSkillWarning[]
}

export type ParsedGithubSkillUrl = {
  owner: string
  repo: string
  kind: "root" | "tree" | "blob"
  segments: string[]
}

type RootOptions = { root?: string; fetch?: GithubFetch }

type TreeEntry = {
  path: string
  mode: string
  type: string
  sha: string
  size?: number
}

type TreeBody = {
  sha: string
  truncated: boolean
  entries: TreeEntry[]
}

type LocatedFolder = {
  ref: string
  path: string
  entries: TreeEntry[]
  truncated: boolean
}

type CollectedSkill = {
  slug: string
  name: string
  description: string
  body: string
  path: string
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof SkillError) return { ok: false, error: error.message }
  console.error(
    "[xiryn] github skills:",
    error instanceof Error ? error.message : "unknown error"
  )
  return { ok: false, error: "Couldn't read that GitHub folder." }
}

function decodeSegment(raw: string): string | null {
  let current = raw
  for (let i = 0; i < 3; i++) {
    if (!current.includes("%")) break
    try {
      const next = decodeURIComponent(current)
      if (next === current) break
      current = next
    } catch {
      return null
    }
  }
  if (current.length === 0 || current.length > 255) return null
  if (
    current.includes("%") ||
    current.includes("/") ||
    current.includes("\\") ||
    current.includes("\0")
  ) {
    return null
  }
  if (/[\u0000-\u001f\u007f]/.test(current)) return null
  if (current === "." || current === "..") return null
  return current
}

export function parseGithubSkillUrl(
  input: string
): { ok: true; value: ParsedGithubSkillUrl } | { ok: false; error: string } {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, error: "Paste a GitHub link." }
  }
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { ok: false, error: "That link isn't a valid URL." }
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Use an https://github.com link." }
  }
  if (url.username || url.password) {
    return { ok: false, error: "That link can't include a username or password." }
  }
  if (url.port) {
    return { ok: false, error: "That link can't include a port." }
  }
  const host = url.hostname.toLowerCase()
  if (host !== "github.com" && host !== "www.github.com") {
    return {
      ok: false,
      error: "Use an https://github.com link to a repository, folder, or SKILL.md file.",
    }
  }
  const parts = url.pathname.split("/").filter((part) => part.length > 0)
  if (parts.length < 2) {
    return { ok: false, error: "That link is missing the repository." }
  }
  const owner = parts[0] ?? ""
  let repo = parts[1] ?? ""
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4)
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    return { ok: false, error: "That repository link isn't valid." }
  }
  const rest = parts.slice(2)
  if (rest.length === 0) {
    return { ok: true, value: { owner, repo, kind: "root", segments: [] } }
  }
  const mode = rest[0]
  if (mode !== "tree" && mode !== "blob") {
    return { ok: false, error: "Link a repository, a folder, or a SKILL.md file." }
  }
  const rawSegments = rest.slice(1)
  if (rawSegments.length === 0) {
    return { ok: false, error: "That link is missing the branch and folder." }
  }
  if (rawSegments.length > MAX_URL_SEGMENTS) {
    return { ok: false, error: "That link is too long. Link the skills folder directly." }
  }
  const segments: string[] = []
  for (const raw of rawSegments) {
    const decoded = decodeSegment(raw)
    if (!decoded) return { ok: false, error: "That skill path is not allowed." }
    segments.push(decoded)
  }
  return { ok: true, value: { owner, repo, kind: mode, segments } }
}

export function assertGithubAssetUrl(url: string, kind: "api" | "raw"): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SkillError("Refusing to fetch a host other than GitHub.")
  }
  const expected = kind === "api" ? API_HOST : RAW_HOST
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== expected ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new SkillError("Refusing to fetch a host other than GitHub.")
  }
  return parsed
}

export async function readBoundedText(
  stream: ReadableStream<Uint8Array> | null,
  max: number
): Promise<string> {
  if (!stream) return ""
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > max) {
        await reader.cancel()
        throw new SkillError("That GitHub response is too large.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function defaultGithubFetch(
  url: string,
  kind: "api" | "raw"
): Promise<GithubAsset> {
  const parsed = assertGithubAssetUrl(url, kind)
  let response: Response
  try {
    response = await fetch(parsed, {
      headers: {
        Accept: kind === "api" ? "application/vnd.github+json" : "text/plain",
        "User-Agent": "xiryn",
        ...(kind === "api" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SkillError("GitHub did not respond in time.")
    }
    const message = error instanceof Error ? error.message : ""
    if (/redirect/i.test(message)) {
      throw new SkillError("GitHub redirected that request, so it was refused.")
    }
    throw new SkillError("Couldn't reach GitHub.")
  }
  const max = kind === "api" ? API_MAX_BYTES : SKILL_MAX_BYTES + 1
  try {
    const body = await readBoundedText(response.body, max)
    return {
      status: response.status,
      body,
      tooLarge: false,
      rateRemaining: response.headers.get("x-ratelimit-remaining"),
    }
  } catch (error) {
    if (error instanceof SkillError) {
      return {
        status: response.status,
        body: "",
        tooLarge: true,
        rateRemaining: response.headers.get("x-ratelimit-remaining"),
      }
    }
    throw error
  }
}

function rateLimited(status: number, body: string, remaining: string | null) {
  if (status !== 403 && status !== 429) return false
  return remaining === "0" || /rate limit/i.test(body)
}

function repoUrl(owner: string, repo: string) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function treeUrl(owner: string, repo: string, id: string, recursive: boolean) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(id)}`
  return recursive ? `${base}?recursive=1` : base
}

function rawUrl(owner: string, repo: string, ref: string, filePath: string) {
  const head = ref.split("/").map(encodeURIComponent).join("/")
  const tail = filePath.split("/").map(encodeURIComponent).join("/")
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${head}/${tail}`
}

function htmlUrl(
  owner: string,
  repo: string,
  ref: string,
  folder: string,
  file: boolean
) {
  const suffix = [ref, folder]
    .filter((part) => part.length > 0)
    .flatMap((part) => part.split("/"))
    .map(encodeURIComponent)
    .join("/")
  const mode = file ? "blob" : "tree"
  return `https://github.com/${owner}/${repo}/${mode}/${suffix}`
}

function labelOf(owner: string, repo: string, ref: string, folder: string) {
  const where = [ref, folder].filter((part) => part.length > 0).join("/")
  return where ? `${owner}/${repo} · ${where}` : `${owner}/${repo}`
}

function safeRelative(value: string, allowSlash: boolean): string | null {
  if (value.length === 0 || value.length > 400) return null
  if (value.includes("\\") || value.includes("\0")) return null
  const parts = value.split("/")
  if (!allowSlash && parts.length !== 1) return null
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null
  return value
}

function ignoredPath(filePath: string) {
  return filePath.split("/").some((part) => part === "node_modules" || part === ".git")
}

function asTree(body: string): TreeBody | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.sha !== "string" || !SHA_RE.test(record.sha)) return null
  if (!Array.isArray(record.tree)) return null
  const entries: TreeEntry[] = []
  for (const entry of record.tree) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    if (typeof item.path !== "string" || typeof item.type !== "string") continue
    if (typeof item.sha !== "string" || !SHA_RE.test(item.sha)) continue
    const mode = typeof item.mode === "string" ? item.mode : ""
    const size = typeof item.size === "number" && item.size >= 0 ? item.size : undefined
    entries.push({ path: item.path, mode, type: item.type, sha: item.sha, size })
  }
  return { sha: record.sha, truncated: record.truncated === true, entries }
}

function defaultBranchOf(body: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const branch = (value as { default_branch?: unknown }).default_branch
  if (typeof branch !== "string") return null
  const segments = branch.split("/")
  if (segments.length === 0 || segments.length > MAX_WALK) return null
  if (segments.some((segment) => decodeSegment(segment) !== segment)) return null
  return branch
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  }
  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

type Session = {
  fetch: GithubFetch
  apiCalls: number
  deadline: number
  defaultBranch: string | null
}

function checkDeadline(session: Session) {
  if (Date.now() > session.deadline) {
    throw new SkillError("GitHub did not finish within 20 seconds.")
  }
}

async function github(session: Session, url: string, kind: "api" | "raw") {
  checkDeadline(session)
  if (kind === "api") {
    session.apiCalls += 1
    if (session.apiCalls > MAX_API_CALLS) {
      throw new SkillError(
        "That link needs too many GitHub requests. Link the skills folder directly."
      )
    }
  }
  assertGithubAssetUrl(url, kind)
  return session.fetch(url, kind)
}

async function loadDefaultBranch(session: Session, owner: string, repo: string) {
  if (session.defaultBranch) return session.defaultBranch
  const response = await github(session, repoUrl(owner, repo), "api")
  if (response.tooLarge) throw new SkillError("That GitHub response is too large.")
  if (rateLimited(response.status, response.body, response.rateRemaining)) {
    throw new SkillError("GitHub rate-limited this computer. Wait a bit and try again.")
  }
  if (response.status === 404 || response.status === 401) {
    throw new SkillError("That GitHub folder isn't public, or the link doesn't exist.")
  }
  if (response.status !== 200)
    throw new SkillError("Couldn't read that GitHub repository.")
  const branch = defaultBranchOf(response.body)
  if (!branch) throw new SkillError("GitHub did not say which branch to read.")
  session.defaultBranch = branch
  return branch
}

async function loadTree(
  session: Session,
  owner: string,
  repo: string,
  id: string,
  idKind: "ref" | "sha",
  recursive: boolean
): Promise<TreeBody | "missing"> {
  if (idKind === "sha" && !SHA_RE.test(id)) {
    throw new SkillError("GitHub returned an unexpected tree id.")
  }
  if (idKind === "ref") {
    const segments = id.split("/")
    if (segments.some((segment) => decodeSegment(segment) !== segment)) {
      throw new SkillError("That skill path is not allowed.")
    }
  }
  const response = await github(session, treeUrl(owner, repo, id, recursive), "api")
  if (response.tooLarge) throw new SkillError("That GitHub response is too large.")
  if (rateLimited(response.status, response.body, response.rateRemaining)) {
    throw new SkillError("GitHub rate-limited this computer. Wait a bit and try again.")
  }
  if (response.status === 404) return "missing"
  if (response.status !== 200) throw new SkillError("Couldn't read that GitHub folder.")
  const tree = asTree(response.body)
  if (!tree)
    throw new SkillError("GitHub returned something that isn't a folder listing.")
  return tree
}

async function locate(
  session: Session,
  owner: string,
  repo: string,
  ref: string,
  folder: string
): Promise<LocatedFolder | "missing" | "not-skill"> {
  const root = await loadTree(session, owner, repo, ref, "ref", false)
  if (root === "missing") return "missing"
  const parts = folder ? folder.split("/") : []
  if (parts.length > MAX_WALK) {
    throw new SkillError("That link is too deep. Link the skills folder directly.")
  }
  let current = root
  const walked: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i] ?? ""
    const entry = current.entries.find((item) => item.path === name)
    if (!entry) {
      if (current.truncated) throw new SkillError("That folder is too large to list.")
      return "missing"
    }
    if (entry.mode === "120000") return "not-skill"
    const last = i === parts.length - 1
    walked.push(name)
    if (entry.type === "blob") {
      if (!last || name !== "SKILL.md") return "not-skill"
      return {
        ref,
        path: walked.join("/"),
        entries: [{ ...entry, path: "SKILL.md" }],
        truncated: false,
      }
    }
    if (entry.type !== "tree") return "missing"
    if (last) {
      const leaf = await loadTree(session, owner, repo, entry.sha, "sha", true)
      if (leaf === "missing") return "missing"
      return {
        ref,
        path: walked.join("/"),
        entries: leaf.entries,
        truncated: leaf.truncated,
      }
    }
    const next = await loadTree(session, owner, repo, entry.sha, "sha", false)
    if (next === "missing") return "missing"
    current = next
  }
  const all = await loadTree(session, owner, repo, root.sha, "sha", true)
  if (all === "missing") return "missing"
  return { ref, path: "", entries: all.entries, truncated: all.truncated }
}

async function resolveFolder(
  session: Session,
  parsed: ParsedGithubSkillUrl
): Promise<LocatedFolder> {
  const attempts: { ref: string; path: string }[] = []
  if (parsed.kind === "root") {
    const branch = await loadDefaultBranch(session, parsed.owner, parsed.repo)
    attempts.push({ ref: branch, path: "" })
  } else {
    const limit = Math.min(parsed.segments.length, MAX_REF_CANDIDATES)
    for (let i = 1; i <= limit; i++) {
      attempts.push({
        ref: parsed.segments.slice(0, i).join("/"),
        path: parsed.segments.slice(i).join("/"),
      })
    }
  }

  let sawNotSkill = false
  for (const attempt of attempts) {
    const located = await locate(
      session,
      parsed.owner,
      parsed.repo,
      attempt.ref,
      attempt.path
    )
    if (located === "missing") continue
    if (located === "not-skill") {
      sawNotSkill = true
      continue
    }
    return located
  }

  if (parsed.kind !== "root") {
    let branch: string | null = null
    try {
      branch = await loadDefaultBranch(session, parsed.owner, parsed.repo)
    } catch (error) {
      if (!sawNotSkill) throw error
    }
    if (branch) {
      const path = parsed.segments.join("/")
      const already = attempts.some(
        (attempt) => attempt.ref === branch && attempt.path === path
      )
      if (!already) {
        const located = await locate(session, parsed.owner, parsed.repo, branch, path)
        if (located !== "missing" && located !== "not-skill") return located
        if (located === "not-skill") sawNotSkill = true
      }
    }
  }

  if (sawNotSkill) throw new SkillError("That file is not a SKILL.md.")
  throw new SkillError("That GitHub folder isn't public, or the link doesn't exist.")
}

function slugFor(prefix: string, entryPath: string, repo: string) {
  const full = prefix ? `${prefix}/${entryPath}` : entryPath
  const dir = full.includes("/") ? full.slice(0, full.lastIndexOf("/")) : ""
  const folder = dir === "" ? repo : (dir.split("/").pop() ?? repo)
  return normalizeSlug(folder)
}

function chooseFiles(located: LocatedFolder, repo: string) {
  const warnings: GithubSkillWarning[] = []
  if (located.truncated) {
    warnings.push({
      path: "",
      message: "GitHub truncated this folder, so some skills may be missing.",
    })
  }
  const singleFile = located.path === "SKILL.md" || located.path.endsWith("/SKILL.md")
  const prefix =
    located.path === "SKILL.md"
      ? ""
      : located.path.endsWith("/SKILL.md")
        ? located.path.slice(0, -"/SKILL.md".length)
        : located.path
  const files: { path: string; slug: string }[] = []
  const seen = new Set<string>()
  let overflow = 0
  const entries = [...located.entries].sort((a, b) => a.path.localeCompare(b.path))
  for (const entry of entries) {
    const relative = safeRelative(entry.path, true)
    if (!relative) continue
    const full = singleFile ? located.path : prefix ? `${prefix}/${relative}` : relative
    if (!safeRelative(full, true) || ignoredPath(full)) continue
    if (!full.endsWith("/SKILL.md") && full !== "SKILL.md") continue
    if (entry.mode === "120000") {
      warnings.push({ path: full, message: "Skipped a symlink." })
      continue
    }
    if (entry.type !== "blob") continue
    if (entry.size !== undefined && entry.size > SKILL_MAX_BYTES) {
      warnings.push({ path: full, message: "Skipped because it is larger than 16 KB." })
      continue
    }
    let slug: string
    try {
      slug = slugFor(prefix, relative, repo)
    } catch (error) {
      warnings.push({
        path: full,
        message:
          error instanceof SkillError ? error.message : "That skill path is not allowed.",
      })
      continue
    }
    if (seen.has(slug)) {
      warnings.push({
        path: full,
        message: `Another file in this folder already uses the slug "${slug}".`,
      })
      continue
    }
    if (files.length >= SKILL_MAX_COUNT) {
      overflow += 1
      continue
    }
    seen.add(slug)
    files.push({ path: full, slug })
  }
  if (overflow > 0) {
    const noun = overflow === 1 ? "file was" : "files were"
    warnings.push({
      path: "",
      message: `${overflow} more SKILL.md ${noun} left out because a library holds at most ${SKILL_MAX_COUNT} skills.`,
    })
  }
  return { files, warnings, prefix, singleFile }
}

async function downloadSkills(
  session: Session,
  owner: string,
  repo: string,
  ref: string,
  files: { path: string; slug: string }[],
  warnings: GithubSkillWarning[]
): Promise<CollectedSkill[]> {
  const loaded = await mapPool(files, DOWNLOAD_CONCURRENCY, async (file) => {
    let response: GithubAsset
    try {
      response = await github(session, rawUrl(owner, repo, ref, file.path), "raw")
    } catch (error) {
      if (error instanceof SkillError) throw error
      return { file, error: "Could not download SKILL.md." }
    }
    if (response.tooLarge || Buffer.byteLength(response.body, "utf8") > SKILL_MAX_BYTES) {
      return { file, error: "Skipped because it is larger than 16 KB." }
    }
    if (rateLimited(response.status, response.body, response.rateRemaining)) {
      throw new SkillError("GitHub rate-limited this computer. Wait a bit and try again.")
    }
    if (response.status !== 200) return { file, error: "Could not download SKILL.md." }
    try {
      const parsed = parseSkillMarkdown(response.body)
      const stored = serializeSkill({
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        source: "github-import",
      })
      if (Buffer.byteLength(stored, "utf8") > SKILL_MAX_BYTES) {
        return { file, error: "Skipped because it is larger than 16 KB." }
      }
      return {
        file,
        skill: {
          slug: file.slug,
          name: parsed.name,
          description: parsed.description,
          body: parsed.body,
          path: file.path,
        } satisfies CollectedSkill,
      }
    } catch (error) {
      return {
        file,
        error:
          error instanceof SkillError ? error.message : "Could not parse this skill.",
      }
    }
  })

  const skills: CollectedSkill[] = []
  for (const item of loaded) {
    if ("skill" in item && item.skill) {
      skills.push(item.skill)
      continue
    }
    warnings.push({ path: item.file.path, message: item.error })
  }
  return skills
}

async function collect(input: string, options?: RootOptions) {
  const parsed = parseGithubSkillUrl(input)
  if (!parsed.ok) throw new SkillError(parsed.error)
  const session: Session = {
    fetch: options?.fetch ?? defaultGithubFetch,
    apiCalls: 0,
    deadline: Date.now() + DEADLINE_MS,
    defaultBranch: null,
  }
  const located = await resolveFolder(session, parsed.value)
  const chosen = chooseFiles(located, parsed.value.repo)
  const skills = await downloadSkills(
    session,
    parsed.value.owner,
    parsed.value.repo,
    located.ref,
    chosen.files,
    chosen.warnings
  )
  if (skills.length === 0) {
    const detail = chosen.warnings
      .slice(0, 4)
      .map((warning) =>
        warning.path ? `${warning.path}: ${warning.message}` : warning.message
      )
      .join(" ")
    throw new SkillError(
      detail
        ? `That folder has no SKILL.md files that can be saved. ${detail}`
        : "That folder has no SKILL.md files."
    )
  }
  return {
    owner: parsed.value.owner,
    repo: parsed.value.repo,
    ref: located.ref,
    path: chosen.singleFile ? (chosen.files[0]?.path ?? chosen.prefix) : chosen.prefix,
    singleFile: chosen.singleFile,
    skills,
    warnings: chosen.warnings,
  }
}

function annotate(skills: CollectedSkill[], root?: string): GithubPreviewSkill[] {
  const existing = new Set(listSkills({ root }).skills.map((skill) => skill.slug))
  let room = SKILL_MAX_COUNT - existing.size
  return skills.map((skill) => {
    if (existing.has(skill.slug)) {
      return { ...skill, replaced: true, canSave: true }
    }
    if (room <= 0) return { ...skill, replaced: false, canSave: false }
    room -= 1
    return { ...skill, replaced: false, canSave: true }
  })
}

export async function previewGithubSkills(
  input: string,
  options?: RootOptions
): Promise<{ ok: true; preview: GithubSkillsPreview } | { ok: false; error: string }> {
  try {
    const found = await collect(input, options)
    return {
      ok: true,
      preview: {
        owner: found.owner,
        repo: found.repo,
        ref: found.ref,
        path: found.path,
        label: labelOf(found.owner, found.repo, found.ref, found.path),
        htmlUrl: htmlUrl(
          found.owner,
          found.repo,
          found.ref,
          found.path,
          found.singleFile
        ),
        skills: annotate(found.skills, options?.root),
        warnings: found.warnings,
      },
    }
  } catch (error) {
    return failure(error)
  }
}

export async function importGithubSkills(
  input: string,
  slugs: string[],
  options?: RootOptions
): Promise<({ ok: true } & SkillImportResult) | { ok: false; error: string }> {
  try {
    if (!Array.isArray(slugs) || slugs.length === 0) {
      throw new SkillError("Select at least one skill.")
    }
    if (slugs.length > SKILL_MAX_COUNT) {
      throw new SkillError(`Choose at most ${SKILL_MAX_COUNT} skills.`)
    }
    const wanted = [...new Set(slugs.map((slug) => assertSkillSlug(slug)))]
    const found = await collect(input, options)
    const bySlug = new Map(found.skills.map((skill) => [skill.slug, skill]))
    const imported: SkillImportResult["imported"] = []
    const warnings: SkillImportResult["warnings"] = found.warnings.map((warning) => ({
      slug: warning.path,
      message: warning.message,
    }))
    for (const slug of wanted) {
      const skill = bySlug.get(slug)
      if (!skill) {
        warnings.push({ slug, message: "That skill is no longer in the folder." })
        continue
      }
      try {
        const saved = writeSkill(
          {
            name: skill.name,
            description: skill.description,
            body: skill.body,
            slug: skill.slug,
            source: "github-import",
          },
          { root: options?.root, replace: true }
        )
        imported.push({ slug: saved.slug, name: saved.name, replaced: saved.replaced })
      } catch (error) {
        const message =
          error instanceof SkillError ? error.message : "Could not import this skill."
        warnings.push({ slug, message })
        if (message.includes(`already has ${SKILL_MAX_COUNT}`)) break
      }
    }
    if (imported.length === 0) {
      throw new SkillError(
        warnings[0]?.message ?? "Nothing in that folder could be imported."
      )
    }
    return { ok: true, imported, warnings }
  } catch (error) {
    return failure(error)
  }
}
