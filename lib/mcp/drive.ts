import { createHash, randomBytes } from "node:crypto"

import { z } from "zod"

import type { driveApprovalArgs } from "@/lib/mcp/approval-preview"

// Google Drive over fetch. No permanent delete. Tokens are not logged, and
// they are stripped from any error text before it leaves this module.

export const DRIVE_PAGE_MAX = 20
export const DRIVE_TEXT_CAP = 100_000
export const DRIVE_BYTE_CAP = 8 * 1024 * 1024
export const DRIVE_UPLOAD_CAP = 1_000_000
const JSON_CAP = 1_000_000
const RATE_RETRIES = 3

export const GOOGLE_DOC = "application/vnd.google-apps.document"
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet"
export const GOOGLE_SLIDE = "application/vnd.google-apps.presentation"
export const GOOGLE_FOLDER = "application/vnd.google-apps.folder"

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,size,webViewLink,trashed"
export const FILE_ID = /^[a-zA-Z0-9_-]{1,128}$/
export const PAGE_TOKEN = /^[A-Za-z0-9\-._~+/=]{1,512}$/
const MIME =
  /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,80}\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,80}$/
const QUERY = /^[^\u0000-\u001F\u007F]{0,200}$/
const EMAIL = /^[^\s@]+@[^\s@]+$/
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i
const PERMISSION_ID = /^[A-Za-z0-9_-]{1,200}$/

export class DriveError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.name = "DriveError"
    this.status = status
  }
}

export type DriveFetch = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string | Uint8Array
    signal?: AbortSignal
    redirect?: RequestRedirect
  }
) => Promise<Response>

export type DriveDeps = {
  token: string
  fetchImpl?: DriveFetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export type DriveFileView = {
  id: string
  name: string
  mimeType: string
  parents: string[]
  modifiedTime: string
  size: string
  link: string
}

type RawFile = {
  id?: string
  name?: string
  mimeType?: string
  parents?: string[]
  modifiedTime?: string
  size?: string
  webViewLink?: string
  trashed?: boolean
}

type DriveApprovalPayload = ReturnType<typeof driveApprovalArgs>

export function redactDriveText(text: string, secrets: string[] = []) {
  let out = text
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]")
  }
  return out
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/ya29\.[0-9A-Za-z_\-]+/g, "[redacted]")
    .replace(/1\/\/[0-9A-Za-z_\-]+/g, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted]")
}

export function mapDriveError(status: number, body: string, secrets: string[] = []) {
  if (status === 401) {
    return "Google Drive refused the sign-in. Reconnect Google from Settings → Connectors."
  }
  if (status === 404) return "That Drive file was not found."
  if (status === 429 || isRateLimited(status, body)) {
    return "Google Drive rate-limited the request. Try again shortly."
  }
  if (status === 403) {
    if (/accessNotConfigured|has not been used|API has not been used/i.test(body)) {
      return "The Google Drive API is not enabled for this Cloud project. Enable it, then try again."
    }
    if (/insufficient|scope|ACCESS_TOKEN_SCOPE|forbidden/i.test(body)) {
      return "Google Drive denied this. Reconnect and grant the Drive scope. Read-write needs the full Drive scope."
    }
    return "Google Drive denied this request."
  }
  const message = googleMessage(body, secrets)
  if (message) return `Google Drive request failed (${status}): ${message}`
  return `Google Drive request failed (${status}).`
}

function googleMessage(body: string, secrets: string[]) {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } }
    const message = json.error?.message
    if (typeof message !== "string" || !message) return ""
    const safe = redactDriveText(message, secrets)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 180)
    if (/[<>]/.test(safe)) return ""
    return safe
  } catch {
    return ""
  }
}

export function isRateLimited(status: number, body: string) {
  if (status === 429) return true
  if (status !== 403) return false
  return /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED/i.test(body)
}

export function assertSafeDriveMethod(method: string, url: string) {
  if (method.toUpperCase() !== "DELETE") return
  const path = new URL(url).pathname.replace(/\/+$/, "")
  // files.delete removes the file forever. Permission deletes are a different path.
  if (/\/files\/[^/]+$/.test(path)) {
    throw new DriveError("Permanent delete is not available.")
  }
}

export function assertGoogleDriveUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new DriveError("Refused a Drive URL that could not be parsed.")
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.googleapis.com") {
    throw new DriveError("Refused a Drive URL that is not https://www.googleapis.com.")
  }
  if (parsed.username || parsed.password) {
    throw new DriveError("Refused a Drive URL with credentials in it.")
  }
}

export function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export function buildDriveQuery(input: {
  query?: string
  folderId?: string
  mimeType?: string
  foldersOnly?: boolean
}) {
  const parts = ["trashed = false"]
  if (input.foldersOnly) parts.push(`mimeType = '${GOOGLE_FOLDER}'`)
  else if (input.mimeType) parts.push(`mimeType = '${escapeDriveQuery(input.mimeType)}'`)
  if (input.folderId) parts.push(`'${escapeDriveQuery(input.folderId)}' in parents`)
  const text = input.query?.trim()
  if (text) {
    const quoted = escapeDriveQuery(text)
    parts.push(`(name contains '${quoted}' or fullText contains '${quoted}')`)
  }
  return parts.join(" and ")
}

export function clampPageSize(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return 10
  return Math.max(1, Math.min(DRIVE_PAGE_MAX, Math.floor(limit)))
}

export type DriveFormat = "markdown" | "text" | "csv" | "pdf-text"

export function exportMime(mime: string, format: DriveFormat | undefined) {
  const chosen = format ?? defaultFormat(mime)
  if (mime === GOOGLE_DOC) {
    if (chosen === "csv") return null
    if (chosen === "text" || chosen === "pdf-text") return "text/plain"
    return "text/markdown"
  }
  if (mime === GOOGLE_SHEET) {
    if (chosen === "markdown") return null
    return "text/csv"
  }
  if (mime === GOOGLE_SLIDE) {
    if (chosen === "csv") return null
    return "text/plain"
  }
  return null
}

function defaultFormat(mime: string): DriveFormat {
  if (mime === GOOGLE_SHEET) return "csv"
  if (mime === GOOGLE_SLIDE) return "text"
  return "markdown"
}

export function capText(text: string, limit = DRIVE_TEXT_CAP) {
  if (text.length <= limit) return { text, truncated: false }
  const omitted = text.length - limit
  return {
    text: `${text.slice(0, limit)}\n… truncated, ${omitted} more chars`,
    truncated: true,
  }
}

export function workspacePath(input: string) {
  const value = input.trim()
  if (!value || value.length > 300) {
    throw new DriveError("The workstation path is empty or too long.")
  }
  if (/[\u0000\r\n]/.test(value))
    throw new DriveError("The workstation path is not valid.")
  const parts = value.split(/[\\/]+/).filter((part) => part && part !== ".")
  if (parts.some((part) => part === "..")) {
    throw new DriveError("The workstation path cannot climb out of the agent workspace.")
  }
  return value
}

function fileId(value: string) {
  if (!FILE_ID.test(value)) throw new DriveError("That Drive file id is not valid.")
  return value
}

function short(value: string | undefined, limit = 500) {
  if (!value) return ""
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

function safeLink(link: string | undefined) {
  if (!link) return ""
  try {
    const url = new URL(link)
    const host = url.hostname
    const google =
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com")
    if (url.protocol !== "https:" || !google) return ""
    return url.toString()
  } catch {
    return ""
  }
}

function presentFile(raw: RawFile): DriveFileView | null {
  if (!raw.id || !FILE_ID.test(raw.id)) return null
  if (raw.trashed) return null
  const parents = (raw.parents ?? []).filter((id) => FILE_ID.test(id)).slice(0, 20)
  return {
    id: raw.id,
    name: short(raw.name),
    mimeType: short(raw.mimeType, 200),
    parents,
    modifiedTime: short(raw.modifiedTime, 40),
    size: short(raw.size, 40),
    link: safeLink(raw.webViewLink),
  }
}

function byteSize(file: DriveFileView) {
  if (!file.size) return null
  const value = Number(file.size)
  return Number.isFinite(value) && value >= 0 ? value : null
}

async function readBody(response: Response, cap: number) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => {})
    return { bytes: Buffer.alloc(0), overflow: true }
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.text())
    if (bytes.length > cap) return { bytes: bytes.subarray(0, cap), overflow: true }
    return { bytes, overflow: false }
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  let overflow = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (total + value.byteLength > cap) {
      overflow = true
      await reader.cancel().catch(() => {})
      break
    }
    total += value.byteLength
    chunks.push(Buffer.from(value))
  }
  return { bytes: Buffer.concat(chunks), overflow }
}

function backoffMs(response: Response, attempt: number) {
  const header = response.headers.get("retry-after")
  const seconds = header === null ? NaN : Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 8_000)
  return Math.min(500 * 2 ** attempt, 4_000)
}

function defaultSleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function driveRequest(
  url: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string | Uint8Array
    cap?: number
  },
  deps: DriveDeps
) {
  const method = init.method ?? "GET"
  assertSafeDriveMethod(method, url)
  assertGoogleDriveUrl(url)
  if (!deps.token) throw new DriveError("Google Drive is not connected.")
  const fetchImpl: DriveFetch =
    deps.fetchImpl ??
    (async (url, init) =>
      fetch(url, {
        method: init?.method,
        headers: init?.headers,
        body: init?.body as BodyInit | undefined,
        redirect: init?.redirect,
        signal: init?.signal,
      }))
  const sleep = deps.sleep ?? defaultSleep
  const cap = init.cap ?? JSON_CAP
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          ...(init.body && !init.headers?.["Content-Type"]
            ? { "Content-Type": "application/json" }
            : {}),
          ...init.headers,
          Authorization: `Bearer ${deps.token}`,
        },
        body: init.body,
        redirect: "error",
        signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed"
      throw new DriveError(
        `Google Drive request failed. ${redactDriveText(message, [deps.token])}`.slice(
          0,
          300
        )
      )
    }
    const body = await readBody(response, response.ok ? cap : Math.min(cap, 65_536))
    // A 403 rate limit is only visible in the body, so peek at that before deciding.
    const peek = body.bytes.toString("utf8")
    if (isRateLimited(response.status, peek) && attempt < RATE_RETRIES) {
      await sleep(backoffMs(response, attempt))
      continue
    }
    if (!response.ok) {
      throw new DriveError(
        mapDriveError(response.status, peek, [deps.token]),
        response.status
      )
    }
    return body
  }
}

function parseJson(bytes: Buffer) {
  const text = bytes.toString("utf8")
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new DriveError("Google Drive returned a response that was not JSON.")
  }
}

export async function listDriveFiles(
  input: {
    query?: string
    folderId?: string
    mimeType?: string
    foldersOnly?: boolean
    pageToken?: string
    limit?: number
  },
  deps: DriveDeps
) {
  if (input.pageToken && !PAGE_TOKEN.test(input.pageToken)) {
    throw new DriveError("That Drive page token is not valid.")
  }
  const pageSize = clampPageSize(input.limit)
  const url = new URL("https://www.googleapis.com/drive/v3/files")
  url.searchParams.set("q", buildDriveQuery(input))
  url.searchParams.set("pageSize", String(pageSize))
  url.searchParams.set("fields", `nextPageToken,files(${FILE_FIELDS})`)
  url.searchParams.set("spaces", "drive")
  url.searchParams.set("corpora", "user")
  url.searchParams.set("supportsAllDrives", "false")
  url.searchParams.set("includeItemsFromAllDrives", "false")
  if (!input.query?.trim()) url.searchParams.set("orderBy", "modifiedTime desc")
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken)
  const { bytes } = await driveRequest(url.toString(), {}, deps)
  const json = parseJson(bytes) as { files?: RawFile[]; nextPageToken?: string } | null
  const files = (json?.files ?? [])
    .slice(0, pageSize)
    .map((file) => presentFile(file))
    .filter((file): file is DriveFileView => file !== null)
  const next = json?.nextPageToken
  return {
    files,
    nextPageToken: next && PAGE_TOKEN.test(next) ? next : null,
  }
}

export async function getDriveFile(id: string, deps: DriveDeps) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId(id)}`)
  url.searchParams.set("fields", FILE_FIELDS)
  url.searchParams.set("supportsAllDrives", "false")
  const { bytes } = await driveRequest(url.toString(), {}, deps)
  const file = presentFile((parseJson(bytes) ?? {}) as RawFile)
  if (!file) throw new DriveError("That Drive file was not found.")
  return file
}

export async function driveAbout(deps: DriveDeps) {
  const url = new URL("https://www.googleapis.com/drive/v3/about")
  url.searchParams.set("fields", "user(emailAddress,displayName)")
  const { bytes } = await driveRequest(url.toString(), {}, deps)
  const json = parseJson(bytes) as {
    user?: { emailAddress?: string; displayName?: string }
  } | null
  const email = (json?.user?.emailAddress ?? "").replace(/[\r\n]/g, "").slice(0, 200)
  const displayName = short(json?.user?.displayName, 200)
  return { email, displayName }
}

export type DriveRead = {
  file: DriveFileView
  text?: string
  truncated?: boolean
  binary?: boolean
  tooLarge?: boolean
  bytes?: Buffer
  note?: string
}

export async function readDriveFile(
  input: { id: string; format?: DriveFormat; download?: boolean },
  deps: DriveDeps
): Promise<DriveRead> {
  const file = await getDriveFile(input.id, deps)
  if (file.mimeType === GOOGLE_FOLDER) {
    return { file, note: "This is a folder." }
  }
  const mime = exportMime(file.mimeType, input.format)
  if (mime) return readExport(file, mime, deps)
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    return {
      file,
      note: "This Google file has no text export for that format. Try another format, or save a copy you can read.",
    }
  }
  const size = byteSize(file)
  if (size !== null && size > DRIVE_BYTE_CAP) {
    return {
      file,
      binary: true,
      tooLarge: true,
      note: `Binary file is ${size} bytes, over the ${DRIVE_BYTE_CAP} byte cap. It was not downloaded.`,
    }
  }
  if (!input.download) {
    return {
      file,
      binary: true,
      note: "Binary file. Pass saveTo to copy it into the workstation under the size cap.",
    }
  }
  const media = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}`)
  media.searchParams.set("alt", "media")
  media.searchParams.set("supportsAllDrives", "false")
  const body = await driveRequest(media.toString(), { cap: DRIVE_BYTE_CAP }, deps)
  if (body.overflow || body.bytes.length > DRIVE_BYTE_CAP) {
    return {
      file,
      binary: true,
      tooLarge: true,
      note: `Binary file is over the ${DRIVE_BYTE_CAP} byte cap. It was not saved.`,
    }
  }
  return { file, binary: true, bytes: body.bytes }
}

async function readExport(file: DriveFileView, mime: string, deps: DriveDeps) {
  const load = (exportMimeType: string) => {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${file.id}/export`)
    url.searchParams.set("mimeType", exportMimeType)
    return driveRequest(url.toString(), { cap: DRIVE_BYTE_CAP }, deps)
  }
  let body
  try {
    body = await load(mime)
  } catch (error) {
    if (mime === "text/markdown" && error instanceof DriveError && error.status === 400) {
      body = await load("text/plain")
    } else {
      throw error
    }
  }
  const decoded = capText(body.bytes.toString("utf8"))
  return {
    file,
    text: decoded.text,
    truncated: decoded.truncated || body.overflow,
  }
}

function multipartBody(meta: Record<string, unknown>, body: Buffer, contentType: string) {
  let boundary = `xiryn_${randomBytes(12).toString("hex")}`
  const payload = body.toString("utf8")
  if (payload.includes(boundary)) boundary = `xiryn_${randomBytes(18).toString("hex")}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    "utf8"
  )
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8")
  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body: Buffer.concat([head, body, tail]),
  }
}

async function uploadBytes(
  input: {
    id?: string
    name: string
    parentId?: string
    metadataMime: string
    bodyMime: string
    body: Buffer
  },
  deps: DriveDeps
) {
  if (
    input.body.length > DRIVE_UPLOAD_CAP &&
    !input.metadataMime.startsWith("application/vnd.google-apps.")
  ) {
    throw new DriveError(`That file is over the ${DRIVE_UPLOAD_CAP} byte upload cap.`)
  }
  if (input.body.length > DRIVE_BYTE_CAP) {
    throw new DriveError(`That file is over the ${DRIVE_BYTE_CAP} byte cap.`)
  }
  const meta: Record<string, unknown> = {
    name: input.name,
    mimeType: input.metadataMime,
  }
  if (input.parentId) meta.parents = [fileId(input.parentId)]
  const part = multipartBody(meta, input.body, input.bodyMime)
  const url = input.id
    ? new URL(`https://www.googleapis.com/upload/drive/v3/files/${fileId(input.id)}`)
    : new URL("https://www.googleapis.com/upload/drive/v3/files")
  url.searchParams.set("uploadType", "multipart")
  url.searchParams.set("supportsAllDrives", "false")
  url.searchParams.set("fields", FILE_FIELDS)
  const { bytes } = await driveRequest(
    url.toString(),
    {
      method: input.id ? "PATCH" : "POST",
      headers: { "Content-Type": part.contentType },
      body: part.body,
    },
    deps
  )
  const file = presentFile((parseJson(bytes) ?? {}) as RawFile)
  if (!file) throw new DriveError("Google Drive did not return the file.")
  return file
}

export type ShareOp =
  | { op: "revoke"; permissionId: string }
  | { op: "grant"; type: "anyone"; role: "reader" | "commenter" | "writer" }
  | {
      op: "grant"
      type: "domain"
      role: "reader" | "commenter" | "writer"
      domain: string
    }
  | {
      op: "grant"
      type: "user" | "group"
      role: "reader" | "commenter" | "writer"
      email: string
    }

export function encodeShareDetail(input: ShareOp) {
  if (input.op === "revoke") return `revoke ${input.permissionId}`
  if (input.type === "anyone") return `grant anyone ${input.role}`
  if (input.type === "domain") return `grant domain ${input.role} ${input.domain}`
  return `grant ${input.type} ${input.role} ${input.email}`
}

export function parseShareDetail(detail: string): ShareOp | null {
  const revoke = /^revoke ([A-Za-z0-9_-]{1,200})$/.exec(detail)
  if (revoke) return { op: "revoke", permissionId: revoke[1] }
  const anyone = /^grant anyone (reader|commenter|writer)$/.exec(detail)
  if (anyone) {
    return {
      op: "grant",
      type: "anyone",
      role: anyone[1] as "reader" | "commenter" | "writer",
    }
  }
  const domain =
    /^grant domain (reader|commenter|writer) ([a-z0-9.-]+\.[a-z]{2,})$/i.exec(detail)
  if (domain) {
    return {
      op: "grant",
      type: "domain",
      role: domain[1] as "reader" | "commenter" | "writer",
      domain: domain[2],
    }
  }
  const user = /^grant (user|group) (reader|commenter|writer) (\S+@\S+)$/.exec(detail)
  if (user && EMAIL.test(user[3])) {
    return {
      op: "grant",
      type: user[1] as "user" | "group",
      role: user[2] as "reader" | "commenter" | "writer",
      email: user[3],
    }
  }
  return null
}

export function shareSentence(input: ShareOp) {
  if (input.op === "revoke") return `Remove access (${input.permissionId})`
  if (input.type === "anyone") return `PUBLIC: anyone with the link as ${input.role}`
  if (input.type === "domain") return `Share with domain ${input.domain} as ${input.role}`
  return `Share with ${input.email} as ${input.role}`
}

export async function applyDriveChange(
  payload: DriveApprovalPayload,
  deps: DriveDeps,
  extra?: { bytes?: Buffer }
) {
  if (payload.sha256) {
    const bytes = extra?.bytes
    if (!bytes)
      throw new DriveError("The workstation file was missing. Approve the upload again.")
    const hash = createHash("sha256").update(bytes).digest("hex")
    if (hash !== payload.sha256) {
      throw new DriveError("The workstation file changed. Approve the upload again.")
    }
  }
  switch (payload.action) {
    case "Create folder":
      return createFolder(payload, deps)
    case "Upload file":
    case "Create Google Doc":
    case "Create Google Sheet":
      return createFile(payload, deps, extra?.bytes)
    case "Rename":
    case "Move":
    case "Update file":
      return updateFile(payload, deps, extra?.bytes)
    case "Copy":
      return copyFile(payload, deps)
    case "Trash":
      return trashFile(payload, deps)
    case "Share":
      return shareFile(payload, deps)
    default:
      throw new DriveError("That Drive action is not available.")
  }
}

async function createFolder(payload: DriveApprovalPayload, deps: DriveDeps) {
  const body: Record<string, unknown> = { name: payload.name, mimeType: GOOGLE_FOLDER }
  if (payload.addParent) body.parents = [fileId(payload.addParent)]
  const url = new URL("https://www.googleapis.com/drive/v3/files")
  url.searchParams.set("fields", FILE_FIELDS)
  url.searchParams.set("supportsAllDrives", "false")
  const { bytes } = await driveRequest(
    url.toString(),
    { method: "POST", body: JSON.stringify(body) },
    deps
  )
  const file = presentFile((parseJson(bytes) ?? {}) as RawFile)
  if (!file) throw new DriveError("Google Drive did not return the folder.")
  return { created: true, file }
}

async function createFile(
  payload: DriveApprovalPayload,
  deps: DriveDeps,
  bytes: Buffer | undefined
) {
  const body = bytes ?? Buffer.from(payload.content, "utf8")
  const metadataMime = payload.mimeType || "text/plain"
  const bodyMime =
    payload.action === "Create Google Sheet"
      ? "text/csv"
      : payload.action === "Create Google Doc"
        ? "text/plain"
        : metadataMime.startsWith("application/vnd.google-apps.")
          ? "text/plain"
          : metadataMime
  const file = await uploadBytes(
    {
      name: payload.newName || payload.name,
      parentId: payload.addParent || undefined,
      metadataMime,
      bodyMime,
      body,
    },
    deps
  )
  return { created: true, file }
}

async function updateFile(
  payload: DriveApprovalPayload,
  deps: DriveDeps,
  bytes: Buffer | undefined
) {
  const id = fileId(payload.fileId)
  if (payload.newName || payload.addParent || payload.removeParents) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}`)
    url.searchParams.set("supportsAllDrives", "false")
    url.searchParams.set("fields", FILE_FIELDS)
    if (payload.addParent) url.searchParams.set("addParents", fileId(payload.addParent))
    if (payload.removeParents) {
      for (const parent of payload.removeParents.split(",")) {
        if (parent && !FILE_ID.test(parent))
          throw new DriveError("A parent id is not valid.")
      }
      url.searchParams.set("removeParents", payload.removeParents)
    }
    const meta: Record<string, unknown> = {}
    if (payload.newName) meta.name = payload.newName
    await driveRequest(
      url.toString(),
      { method: "PATCH", body: JSON.stringify(meta) },
      deps
    )
  }
  if (payload.content || bytes) {
    const current = await getDriveFile(id, deps)
    if (current.mimeType.startsWith("application/vnd.google-apps.")) {
      throw new DriveError(
        "In-place edits of a Google Doc, Sheet or Slide are not available. Create a new one instead."
      )
    }
    await uploadBytes(
      {
        id,
        name: payload.newName || current.name,
        metadataMime: current.mimeType || "text/plain",
        bodyMime: current.mimeType || "text/plain",
        body: bytes ?? Buffer.from(payload.content, "utf8"),
      },
      deps
    )
  }
  const file = await getDriveFile(id, deps)
  return { updated: true, file }
}

async function copyFile(payload: DriveApprovalPayload, deps: DriveDeps) {
  const body: Record<string, unknown> = { name: payload.newName || payload.name }
  if (payload.addParent) body.parents = [fileId(payload.addParent)]
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${fileId(payload.fileId)}/copy`
  )
  url.searchParams.set("fields", FILE_FIELDS)
  url.searchParams.set("supportsAllDrives", "false")
  const { bytes } = await driveRequest(
    url.toString(),
    { method: "POST", body: JSON.stringify(body) },
    deps
  )
  const file = presentFile((parseJson(bytes) ?? {}) as RawFile)
  if (!file) throw new DriveError("Google Drive did not return the copy.")
  return { copied: true, file }
}

async function trashFile(payload: DriveApprovalPayload, deps: DriveDeps) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${fileId(payload.fileId)}`
  )
  url.searchParams.set("supportsAllDrives", "false")
  url.searchParams.set("fields", "id,trashed")
  await driveRequest(
    url.toString(),
    { method: "PATCH", body: JSON.stringify({ trashed: true }) },
    deps
  )
  return { trashed: true, id: payload.fileId }
}

async function shareFile(payload: DriveApprovalPayload, deps: DriveDeps) {
  const change = parseShareDetail(payload.detail)
  if (!change) throw new DriveError("That sharing change is not valid.")
  const id = fileId(payload.fileId)
  if (change.op === "revoke") {
    const url = new URL(
      `https://www.googleapis.com/drive/v3/files/${id}/permissions/${encodeURIComponent(change.permissionId)}`
    )
    url.searchParams.set("supportsAllDrives", "false")
    await driveRequest(url.toString(), { method: "DELETE" }, deps)
    return { shared: true, id, removed: change.permissionId }
  }
  const body: Record<string, unknown> = {
    type: change.type,
    role: change.role,
    allowFileDiscovery: false,
  }
  if (change.type === "user" || change.type === "group") body.emailAddress = change.email
  if (change.type === "domain") body.domain = change.domain
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}/permissions`)
  url.searchParams.set("supportsAllDrives", "false")
  url.searchParams.set("sendNotificationEmail", "false")
  url.searchParams.set("fields", "id,type,role,emailAddress,domain")
  const { bytes } = await driveRequest(
    url.toString(),
    { method: "POST", body: JSON.stringify(body) },
    deps
  )
  return { shared: true, id, permission: parseJson(bytes) }
}

export async function listDrivePermissions(id: string, deps: DriveDeps) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${fileId(id)}/permissions`
  )
  url.searchParams.set("pageSize", "50")
  url.searchParams.set(
    "fields",
    "nextPageToken,permissions(id,type,role,emailAddress,domain,displayName)"
  )
  url.searchParams.set("supportsAllDrives", "false")
  const { bytes } = await driveRequest(url.toString(), {}, deps)
  const json = parseJson(bytes) as {
    permissions?: {
      id?: string
      type?: string
      role?: string
      emailAddress?: string
      domain?: string
      displayName?: string
    }[]
    nextPageToken?: string
  } | null
  const permissions = (json?.permissions ?? []).slice(0, 50).map((item) => ({
    id: short(item.id, 200),
    type: short(item.type, 40),
    role: short(item.role, 40),
    email: short(item.emailAddress, 320),
    domain: short(item.domain, 253),
    displayName: short(item.displayName, 200),
  }))
  return {
    permissions,
    nextPageToken:
      json?.nextPageToken && PAGE_TOKEN.test(json.nextPageToken)
        ? json.nextPageToken
        : null,
  }
}

const fileIdSchema = z.string().regex(FILE_ID)
const folderSchema = fileIdSchema.optional()

export function shareInputError(input: {
  op: "grant" | "revoke"
  type?: "user" | "group" | "domain" | "anyone"
  role?: "reader" | "commenter" | "writer"
  email?: string
  domain?: string
  permissionId?: string
}) {
  if (input.op === "revoke") {
    if (!input.permissionId) return "Revoking access needs a permission id."
    return null
  }
  if (!input.type || !input.role) return "Granting access needs a type and a role."
  if ((input.type === "user" || input.type === "group") && !input.email) {
    return "Sharing with a person needs their email address."
  }
  if (input.type === "domain" && !input.domain)
    return "Sharing with a domain needs the domain."
  if (input.type === "anyone" && (input.email || input.domain)) {
    return "A public link does not take an email or a domain."
  }
  return null
}

export const driveToolSchemas = {
  drive_search: z.object({
    query: z
      .string()
      .regex(QUERY)
      .optional()
      .describe("Text matched against the name and contents."),
    folderId: folderSchema.describe("Limit the search to this folder id."),
    mimeType: z.string().regex(MIME).optional(),
    pageToken: z.string().regex(PAGE_TOKEN).optional(),
    limit: z.number().int().min(1).max(DRIVE_PAGE_MAX).optional(),
  }),
  drive_list_folders: z.object({
    folderId: folderSchema.describe("Parent folder. Omit for My Drive."),
    pageToken: z.string().regex(PAGE_TOKEN).optional(),
    limit: z.number().int().min(1).max(DRIVE_PAGE_MAX).optional(),
  }),
  drive_get: z.object({ id: fileIdSchema }),
  drive_read: z.object({
    id: fileIdSchema,
    format: z.enum(["markdown", "text", "csv", "pdf-text"]).optional(),
    saveTo: z
      .string()
      .max(300)
      .optional()
      .describe(
        "Workstation path to save the file. Omit to only return text or metadata."
      ),
  }),
  drive_list_permissions: z.object({ id: fileIdSchema }),
  drive_create_folder: z.object({
    name: z.string().min(1).max(200),
    folderId: folderSchema,
  }),
  drive_create_file: z
    .object({
      name: z.string().min(1).max(200),
      content: z.string().max(DRIVE_TEXT_CAP).optional(),
      workspacePath: z.string().max(300).optional(),
      folderId: folderSchema,
      mimeType: z.string().regex(MIME).optional(),
    })
    .superRefine((value, ctx) => {
      const hasContent = value.content !== undefined
      const hasPath = Boolean(value.workspacePath)
      if (hasContent === hasPath) {
        ctx.addIssue({
          code: "custom",
          message: "Provide file content or a workstation path, not both.",
        })
      }
    }),
  drive_create_doc: z.object({
    kind: z.enum(["doc", "sheet"]),
    name: z.string().min(1).max(200),
    content: z.string().min(1).max(DRIVE_TEXT_CAP),
    folderId: folderSchema,
  }),
  drive_update_file: z
    .object({
      id: fileIdSchema,
      name: z.string().min(1).max(200).optional(),
      folderId: folderSchema,
      content: z.string().max(DRIVE_TEXT_CAP).optional(),
    })
    .superRefine((value, ctx) => {
      if (!value.name && !value.folderId && value.content === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Provide a new name, a folder, or new content.",
        })
      }
    }),
  drive_copy_file: z.object({
    id: fileIdSchema,
    name: z.string().min(1).max(200).optional(),
    folderId: folderSchema,
  }),
  drive_trash: z.object({ id: fileIdSchema }),
  drive_share: z
    .object({
      id: fileIdSchema,
      op: z.enum(["grant", "revoke"]),
      type: z.enum(["user", "group", "domain", "anyone"]).optional(),
      role: z.enum(["reader", "commenter", "writer"]).optional(),
      email: z.string().regex(EMAIL).max(320).optional(),
      domain: z.string().regex(DOMAIN).max(253).optional(),
      permissionId: z.string().regex(PERMISSION_ID).optional(),
    })
    .superRefine((value, ctx) => {
      const message = shareInputError(value)
      if (message) ctx.addIssue({ code: "custom", message })
    }),
}
