import fs from "node:fs"
import path from "node:path"

// Reusable playbooks in data/skills/<slug>/SKILL.md. The agent can read them
// and cannot write them. A skill is prompt text, not a script: nothing here
// executes the Markdown.

export const SKILL_MAX_BYTES = 16 * 1024
export const SKILL_MAX_COUNT = 64
export const SKILL_CATALOG_LIMIT = 40
export const SKILL_NAME_MAX = 80
export const SKILL_DESCRIPTION_MAX = 1024

const SKILL_FILE = "SKILL.md"
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class SkillError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SkillError"
  }
}

export type Skill = {
  slug: string
  name: string
  description: string
  body: string
}

export type SkillWarning = {
  slug: string
  message: string
}

export type SkillLibrary = {
  skills: Skill[]
  warnings: SkillWarning[]
}

export type SkillCatalog = {
  skills: { slug: string; name: string; description: string }[]
  omitted: number
  warnings: SkillWarning[]
}

type RootOptions = { root?: string }

// Same directory rule as db/index.ts (`XIRYN_DATA_DIR` or `data`). Kept here
// so reading a skill does not open SQLite. Callers can pass `root` in tests.
function defaultSkillsRoot() {
  const dataDir = path.resolve(
    /*turbopackIgnore: true*/ process.env.XIRYN_DATA_DIR || "data"
  )
  return path.join(dataDir, "skills")
}

function rootOf(options?: RootOptions) {
  return path.resolve(/*turbopackIgnore: true*/ options?.root ?? defaultSkillsRoot())
}

export function normalizeSlug(input: string): string {
  if (typeof input !== "string") {
    throw new SkillError("Use a name with at least one letter or number.")
  }
  // A path is not a name. Rewriting "../" into a slug would point at a
  // different skill instead of refusing the traversal.
  if (
    input.includes("..") ||
    input.includes("/") ||
    input.includes("\\") ||
    input.includes("\0")
  ) {
    throw new SkillError("That skill path is not allowed.")
  }
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
  if (!SLUG_RE.test(slug)) {
    throw new SkillError("Use a name with at least one letter or number.")
  }
  return slug
}

export function assertSkillSlug(slug: string): string {
  if (typeof slug !== "string" || !SLUG_RE.test(slug) || slug.length > 64) {
    throw new SkillError("That skill path is not allowed.")
  }
  if (
    slug.includes("..") ||
    slug.includes("/") ||
    slug.includes("\\") ||
    slug.includes("\0")
  ) {
    throw new SkillError("That skill path is not allowed.")
  }
  return slug
}

// The skill directory, or a throw. Never a path outside `root`.
export function skillDirectory(slug: string, root: string): string {
  const safe = assertSkillSlug(slug)
  const base = path.resolve(/*turbopackIgnore: true*/ root)
  const dir = path.resolve(/*turbopackIgnore: true*/ base, safe)
  const relative = path.relative(base, dir)
  if (relative !== safe || relative.includes("..") || path.isAbsolute(relative)) {
    throw new SkillError("That skill path is not allowed.")
  }
  return dir
}

function assertRealInside(root: string, target: string) {
  const base = fs.realpathSync(/*turbopackIgnore: true*/ root)
  const real = fs.realpathSync(/*turbopackIgnore: true*/ target)
  const relative = path.relative(base, real)
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SkillError("That skill path is not allowed.")
  }
}

function requireText(value: string | undefined, label: string, max: number) {
  const text = (value ?? "").trim()
  if (!text) throw new SkillError(`Frontmatter is missing a ${label}.`)
  if (text.length > max) {
    throw new SkillError(`Frontmatter ${label} must be ${max} characters or fewer.`)
  }
  if (label === "name" && /[\r\n]/.test(text)) {
    throw new SkillError("Frontmatter name must be a single line.")
  }
  return text
}

function unquoteScalar(key: string, value: string) {
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new SkillError(`Frontmatter value for ${key} is missing a closing quote.`)
    }
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new SkillError(`Frontmatter value for ${key} is missing a closing quote.`)
    }
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

function takeIndented(lines: string[], start: number) {
  const collected: string[] = []
  let i = start
  let indent: number | null = null
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === "") {
      if (indent !== null) collected.push("")
      i++
      continue
    }
    const current = /^[ \t]*/.exec(line)?.[0].length ?? 0
    if (current === 0) break
    if (indent === null) indent = current
    if (current < indent) break
    collected.push(line.slice(indent))
    i++
  }
  return { text: collected.join("\n").trim(), next: i }
}

function foldScalar(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .replace(/\n/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n")
}

function parseFrontmatterBlock(block: string) {
  const lines = block.split(/\r?\n/)
  const fields: Record<string, string> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === "" || /^\s*#/.test(line)) {
      i++
      continue
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (!match) {
      throw new SkillError(`Could not read the frontmatter ("${line.slice(0, 60)}").`)
    }
    const key = match[1]
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new SkillError(`Frontmatter repeats "${key}".`)
    }
    const indicator = match[2].trim()
    if (
      indicator === "|" ||
      indicator === "|-" ||
      indicator === ">" ||
      indicator === ">-"
    ) {
      const consumed = takeIndented(lines, i + 1)
      fields[key] = indicator.startsWith(">") ? foldScalar(consumed.text) : consumed.text
      i = consumed.next
      continue
    }
    if (indicator === "") {
      const consumed = takeIndented(lines, i + 1)
      fields[key] = consumed.text
      i = consumed.next
      continue
    }
    fields[key] = unquoteScalar(key, indicator)
    i++
  }
  return fields
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/

export function parseSkillMarkdown(raw: string): {
  name: string
  description: string
  body: string
} {
  if (typeof raw !== "string") throw new SkillError("A skill file must be text.")
  if (raw.includes("\0")) throw new SkillError("A skill file cannot contain null bytes.")
  const source = raw.replace(/^\uFEFF/, "").replace(/^\s+/, "")
  const match = FRONTMATTER.exec(source)
  if (!match) {
    throw new SkillError(
      "A skill needs YAML frontmatter with a name and a description, then Markdown."
    )
  }
  const fields = parseFrontmatterBlock(match[1])
  const name = requireText(fields.name, "name", SKILL_NAME_MAX)
  const description = requireText(
    fields.description,
    "description",
    SKILL_DESCRIPTION_MAX
  )
  let body = match[2] ?? ""
  if (body.startsWith("\r\n")) body = body.slice(2)
  else if (body.startsWith("\n")) body = body.slice(1)
  body = body.replace(/\s+$/, "")
  return { name, description, body }
}

function yamlScalar(value: string) {
  if (value.includes("\n")) {
    const block = value
      .replace(/\s+$/, "")
      .split("\n")
      .map((line) => (line.length > 0 ? `  ${line}` : ""))
      .join("\n")
    return `|\n${block}`
  }
  if (
    value === "" ||
    value !== value.trim() ||
    /[:#{}[\],&*?|>!%@`'"]/.test(value) ||
    /^(?:true|false|null|yes|no|~|\d+)$/i.test(value)
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return value
}

export function serializeSkill(skill: {
  name: string
  description: string
  body: string
}): string {
  const body = skill.body.replace(/\s+$/, "")
  const lines = [
    "---",
    `name: ${yamlScalar(skill.name)}`,
    `description: ${yamlScalar(skill.description)}`,
    "---",
    "",
  ]
  if (body) lines.push(body, "")
  return lines.join("\n")
}

function skillFile(slug: string, root: string) {
  return path.join(skillDirectory(slug, root), SKILL_FILE)
}

export function listSkills(options?: RootOptions): SkillLibrary {
  const root = rootOf(options)
  if (!fs.existsSync(/*turbopackIgnore: true*/ root)) return { skills: [], warnings: [] }
  const rootStat = fs.lstatSync(/*turbopackIgnore: true*/ root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return {
      skills: [],
      warnings: [
        {
          slug: "",
          message: "The skills folder is missing or is a symlink, so nothing was loaded.",
        },
      ],
    }
  }

  const warnings: SkillWarning[] = []
  const skills: Skill[] = []
  const names = fs
    .readdirSync(/*turbopackIgnore: true*/ root, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name !== "." && name !== "..")
    .sort((a, b) => a.localeCompare(b))

  for (const name of names) {
    const dir = path.join(root, name)
    let dirStat: fs.Stats
    try {
      dirStat = fs.lstatSync(/*turbopackIgnore: true*/ dir)
    } catch {
      warnings.push({ slug: name, message: "Could not read this folder." })
      continue
    }
    if (dirStat.isSymbolicLink()) {
      warnings.push({ slug: name, message: "Skipped a symlinked folder." })
      continue
    }
    if (!dirStat.isDirectory()) continue
    if (!SLUG_RE.test(name)) {
      warnings.push({
        slug: name,
        message: "Skipped a folder whose name is not a lowercase slug.",
      })
      continue
    }
    const file = path.join(dir, SKILL_FILE)
    let fileStat: fs.Stats
    try {
      fileStat = fs.lstatSync(/*turbopackIgnore: true*/ file)
    } catch {
      // No SKILL.md in this folder.
      continue
    }
    if (fileStat.isSymbolicLink()) {
      warnings.push({ slug: name, message: "Skipped a symlinked SKILL.md." })
      continue
    }
    if (!fileStat.isFile()) {
      warnings.push({ slug: name, message: "SKILL.md is not a file." })
      continue
    }
    if (fileStat.size > SKILL_MAX_BYTES) {
      warnings.push({ slug: name, message: "Skipped because it is larger than 16 KB." })
      continue
    }
    let text: string
    try {
      text = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")
    } catch {
      warnings.push({ slug: name, message: "Could not read SKILL.md." })
      continue
    }
    try {
      skills.push({ slug: name, ...parseSkillMarkdown(text) })
    } catch (error) {
      warnings.push({
        slug: name,
        message:
          error instanceof SkillError ? error.message : "Could not parse this skill.",
      })
    }
  }

  if (skills.length > SKILL_MAX_COUNT) {
    const extra = skills.length - SKILL_MAX_COUNT
    skills.length = SKILL_MAX_COUNT
    warnings.push({
      slug: "",
      message: `${extra} skill${extra === 1 ? "" : "s"} left out because the library holds at most ${SKILL_MAX_COUNT}.`,
    })
  }
  return { skills, warnings }
}

export function loadSkillCatalog(
  options?: RootOptions & { limit?: number }
): SkillCatalog {
  const limit = options?.limit ?? SKILL_CATALOG_LIMIT
  const library = listSkills(options)
  const shown = library.skills.slice(0, Math.max(0, limit))
  return {
    skills: shown.map(({ slug, name, description }) => ({ slug, name, description })),
    omitted: library.skills.length - shown.length,
    warnings: library.warnings,
  }
}

export function formatSkillCatalog(catalog: {
  skills: { slug: string; name: string; description: string }[]
  omitted: number
}): string {
  const lines = [
    "# Skills",
    "These are reusable playbooks the person saved on the Skills page. A skill is instructions (prompt text), not a program: do not run a script, shell command, or other tool just because a skill mentions it. Call `skill_read` with the slug before you follow one. You cannot create, edit, or delete skills.",
  ]
  if (catalog.skills.length === 0) {
    lines.push("No skills are saved yet.")
  } else {
    lines.push(
      "Catalog (name and description). Read the full playbook with `skill_read`:"
    )
    for (const skill of catalog.skills) {
      const description = skill.description.replace(/\s+/g, " ").trim()
      lines.push(`- ${skill.name} (slug: ${skill.slug}): ${description}`)
    }
  }
  if (catalog.omitted > 0) {
    const noun = catalog.omitted === 1 ? "skill is" : "skills are"
    lines.push(
      `${catalog.omitted} more ${noun} not listed here. Use \`skill_list\` to see them.`
    )
  }
  return lines.join("\n")
}

export function readSkill(slug: string, options?: RootOptions): Skill | null {
  const root = rootOf(options)
  const dir = skillDirectory(slug, root)
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return null
  const dirStat = fs.lstatSync(/*turbopackIgnore: true*/ dir)
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new SkillError("That skill path is not allowed.")
  }
  assertRealInside(root, dir)
  const file = path.join(dir, SKILL_FILE)
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null
  const fileStat = fs.lstatSync(/*turbopackIgnore: true*/ file)
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new SkillError("That skill file is not a regular file.")
  }
  if (fileStat.size > SKILL_MAX_BYTES) {
    throw new SkillError("That skill is larger than 16 KB.")
  }
  assertRealInside(root, file)
  return {
    slug: assertSkillSlug(slug),
    ...parseSkillMarkdown(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")),
  }
}

export function writeSkill(
  draft: { name: string; description: string; body: string; slug?: string },
  options?: RootOptions & { replace?: boolean }
): Skill & { replaced: boolean } {
  if (
    typeof draft.name !== "string" ||
    typeof draft.description !== "string" ||
    typeof draft.body !== "string"
  ) {
    throw new SkillError("A skill file must be text.")
  }
  if (
    draft.body.includes("\0") ||
    draft.name.includes("\0") ||
    draft.description.includes("\0")
  ) {
    throw new SkillError("A skill cannot contain null bytes.")
  }
  const name = requireText(draft.name, "name", SKILL_NAME_MAX)
  const description = requireText(draft.description, "description", SKILL_DESCRIPTION_MAX)
  const body = draft.body.replace(/\s+$/, "")
  const slug = draft.slug ? assertSkillSlug(draft.slug) : normalizeSlug(name)
  const markdown = serializeSkill({ name, description, body })
  if (Buffer.byteLength(markdown, "utf8") > SKILL_MAX_BYTES) {
    throw new SkillError("A skill must be 16 KB or smaller.")
  }

  const root = rootOf(options)
  fs.mkdirSync(/*turbopackIgnore: true*/ root, { recursive: true })
  const rootStat = fs.lstatSync(/*turbopackIgnore: true*/ root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new SkillError("The skills folder is missing or is a symlink.")
  }

  const dir = skillDirectory(slug, root)
  const file = path.join(dir, SKILL_FILE)
  // Stat the directory itself before any path that would follow a symlink.
  let dirStat: fs.Stats | undefined
  try {
    dirStat = fs.lstatSync(/*turbopackIgnore: true*/ dir)
  } catch {
    dirStat = undefined
  }
  if (dirStat) {
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new SkillError("Refusing to write through a symlink.")
    }
    assertRealInside(root, dir)
  }
  let fileStat: fs.Stats | undefined
  if (dirStat) {
    try {
      fileStat = fs.lstatSync(/*turbopackIgnore: true*/ file)
    } catch {
      fileStat = undefined
    }
  }
  if (fileStat?.isSymbolicLink()) {
    throw new SkillError("Refusing to write through a symlink.")
  }
  const replaced = Boolean(fileStat?.isFile())
  if (replaced && !options?.replace) {
    throw new SkillError(`A skill named "${slug}" already exists.`)
  }
  if (!replaced && listSkills({ root }).skills.length >= SKILL_MAX_COUNT) {
    throw new SkillError(
      `The skills library already has ${SKILL_MAX_COUNT} skills. Delete one before adding another.`
    )
  }

  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
  const tmp = path.join(dir, `.${SKILL_FILE}.${process.pid}.tmp`)
  try {
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, markdown, {
      encoding: "utf8",
      mode: 0o644,
    })
    fs.renameSync(/*turbopackIgnore: true*/ tmp, file)
  } catch (error) {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ tmp)
    } catch {
      // The temp file may already be gone.
    }
    const reason = error instanceof Error ? error.message : "unknown error"
    throw new SkillError(`Could not save that skill (${reason}).`)
  }
  return { slug, name, description, body, replaced }
}

export function deleteSkill(slug: string, options?: RootOptions) {
  const root = rootOf(options)
  const dir = skillDirectory(slug, root)
  const file = skillFile(slug, root)
  if (
    !fs.existsSync(/*turbopackIgnore: true*/ dir) ||
    !fs.existsSync(/*turbopackIgnore: true*/ file)
  ) {
    throw new SkillError("That skill no longer exists.")
  }
  const dirStat = fs.lstatSync(/*turbopackIgnore: true*/ dir)
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new SkillError("That skill path is not allowed.")
  }
  assertRealInside(root, dir)
  const fileStat = fs.lstatSync(/*turbopackIgnore: true*/ file)
  if (fileStat.isSymbolicLink()) {
    fs.unlinkSync(/*turbopackIgnore: true*/ file)
  } else if (!fileStat.isFile()) {
    throw new SkillError("That skill file is not a regular file.")
  } else {
    assertRealInside(root, file)
    fs.unlinkSync(/*turbopackIgnore: true*/ file)
  }
  if (fs.readdirSync(/*turbopackIgnore: true*/ dir).length === 0) {
    fs.rmdirSync(/*turbopackIgnore: true*/ dir)
  }
}

export type SkillImportResult = {
  imported: { slug: string; name: string; replaced: boolean }[]
  warnings: SkillWarning[]
}

function slugFromFilename(filename: string | undefined) {
  if (!filename) return undefined
  const base = path.basename(filename).replace(/\.(md|markdown)$/i, "")
  if (/^skill$/i.test(base)) return undefined
  if (base.includes("..") || base.includes("/") || base.includes("\\")) return undefined
  try {
    return normalizeSlug(base)
  } catch {
    return undefined
  }
}

function isBundle(value: unknown): value is {
  skills: { slug?: unknown; markdown?: unknown }[]
} {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    record.format === "xiryn-skills" &&
    record.version === 1 &&
    Array.isArray(record.skills)
  )
}

function importOne(
  markdown: string,
  slug: string | undefined,
  root: string
): { slug: string; name: string; replaced: boolean } {
  const parsed = parseSkillMarkdown(markdown)
  const finalSlug = slug ? assertSkillSlug(slug) : normalizeSlug(parsed.name)
  const saved = writeSkill({ ...parsed, slug: finalSlug }, { root, replace: true })
  return { slug: saved.slug, name: saved.name, replaced: saved.replaced }
}

export function importSkillsText(
  text: string,
  options?: RootOptions & { filename?: string }
): SkillImportResult {
  if (typeof text !== "string" || text.trim() === "") {
    throw new SkillError("That file is empty.")
  }
  if (text.includes("\0")) throw new SkillError("That file cannot contain null bytes.")
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
    throw new SkillError("That import is larger than 2 MB.")
  }
  const root = rootOf(options)
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new SkillError("That file is not valid JSON or a skill.")
    }
    if (!isBundle(parsed)) {
      throw new SkillError("That JSON is not an Xiryn skills export.")
    }
    if (parsed.skills.length === 0) {
      throw new SkillError("That export contains no skills.")
    }
    const imported: SkillImportResult["imported"] = []
    const warnings: SkillWarning[] = []
    for (const entry of parsed.skills) {
      const label = typeof entry.slug === "string" ? entry.slug : ""
      if (typeof entry.markdown !== "string") {
        warnings.push({
          slug: label,
          message: "Skipped an entry that is not a skill file.",
        })
        continue
      }
      let slug: string | undefined
      if (typeof entry.slug === "string" && entry.slug.trim() !== "") {
        try {
          slug = assertSkillSlug(entry.slug)
        } catch (error) {
          warnings.push({
            slug: label,
            message:
              error instanceof SkillError
                ? error.message
                : "That skill path is not allowed.",
          })
          continue
        }
      }
      try {
        imported.push(importOne(entry.markdown, slug, root))
      } catch (error) {
        const message =
          error instanceof SkillError ? error.message : "Could not import this skill."
        warnings.push({ slug: slug ?? label, message })
        if (message.includes(`at most ${SKILL_MAX_COUNT}`)) break
      }
    }
    if (imported.length === 0) {
      throw new SkillError(
        warnings[0]?.message ?? "Nothing in that file could be imported."
      )
    }
    return { imported, warnings }
  }

  const saved = importOne(trimmed, slugFromFilename(options?.filename), root)
  return { imported: [saved], warnings: [] }
}

export function exportSkillMarkdown(slug: string, options?: RootOptions) {
  const skill = readSkill(slug, options)
  if (!skill) throw new SkillError("That skill no longer exists.")
  return serializeSkill(skill)
}

export function exportSkillsBundle(options?: RootOptions) {
  const { skills } = listSkills(options)
  return JSON.stringify(
    {
      format: "xiryn-skills",
      version: 1,
      skills: skills.map((skill) => ({
        slug: skill.slug,
        markdown: serializeSkill(skill),
      })),
    },
    null,
    2
  )
}
