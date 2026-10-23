import { supportsImageInput } from "@/lib/providers/catalog"

// Files a person attaches in the composer. They live in the agent's
// workstation at /home/xiryn/uploads, which is the home folder the container
// already persists. Names are sanitized; nothing here reads or runs the bytes.

export const MAX_FILES_PER_MESSAGE = 10
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const UPLOADS_DIR = "/home/xiryn/uploads"
const NAME_MAX = 80

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AttachmentError"
  }
}

export type Attachment = {
  name: string
  storedName: string
  mediaType: string
  size: number
  path: string
  agentId: string
}

export type StoredUpload = Omit<Attachment, "size" | "agentId">

const PREFIX = /^[A-Za-z0-9_-]{4,16}$/
const AGENT_ID = /^[A-Za-z0-9_-]{1,32}$/

const EXTENSION_MEDIA: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  webm: "video/webm",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  zip: "application/zip",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  css: "text/plain",
  py: "text/plain",
  html: "application/octet-stream",
  htm: "application/octet-stream",
  svg: "application/octet-stream",
  xml: "application/octet-stream",
}

const IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

export function isAgentId(value: string) {
  return AGENT_ID.test(value)
}

export function isImageMedia(mediaType: string) {
  return IMAGES.has(mediaType)
}

export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded =
    value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

export function sanitizeFileName(input: string) {
  const base = input.replaceAll("\\", "/").split("/").pop() ?? ""
  let name = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0x20 && code !== 0x7f
    })
    .join("")
  name = name.replaceAll("..", "").replaceAll(/[\\/]/g, "").trim().replace(/^\.+/, "")
  if (!name || name === "." || name === "..") name = "file"
  if (name.length > NAME_MAX) {
    const dot = name.lastIndexOf(".")
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : ""
    name = `${name.slice(0, NAME_MAX - ext.length)}${ext}` || "file"
  }
  return name
}

export function mediaTypeFor(filename: string, claimed?: string | null) {
  const ext = extensionOf(filename)
  const fromExt = EXTENSION_MEDIA[ext] ?? "application/octet-stream"
  if (!claimed) return fromExt
  const clean = claimed.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!clean || clean !== fromExt) return fromExt
  return fromExt
}

function extensionOf(filename: string) {
  const base = filename.replaceAll("\\", "/").split("/").pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return ""
  return base.slice(dot + 1).toLowerCase()
}

function normalizePosix(input: string) {
  const absolute = input.startsWith("/")
  const parts: string[] = []
  for (const part of input.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`
}

// True only for one regular file directly inside the workstation uploads folder.
export function isInsideUploads(input: string) {
  if (typeof input !== "string" || input.length === 0 || input.length > 240) return false
  if (input.includes("\0") || input.includes("\\")) return false
  let value = input
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value)
    } catch {
      return false
    }
  }
  if (value.includes("\0") || value.includes("\\")) return false
  if (value.split("/").includes("..")) return false
  const normalized = normalizePosix(value)
  if (!normalized?.startsWith(`${UPLOADS_DIR}/`)) return false
  const rest = normalized.slice(UPLOADS_DIR.length + 1)
  return rest.length > 0 && !rest.includes("/")
}

export function uploadPathForName(storedName: string) {
  if (!storedName || storedName.length > 16 + 1 + NAME_MAX) return null
  if (
    storedName.includes("/") ||
    storedName.includes("\\") ||
    storedName.includes("..") ||
    /[\u0000-\u001f\u007f]/.test(storedName)
  ) {
    return null
  }
  let prefixOk = false
  for (let length = 4; length <= 16 && length < storedName.length; length++) {
    if (storedName[length] !== "-") continue
    if (PREFIX.test(storedName.slice(0, length)) && storedName.length > length + 1) {
      prefixOk = true
      break
    }
  }
  if (!prefixOk) return null
  const full = `${UPLOADS_DIR}/${storedName}`
  return isInsideUploads(full) ? full : null
}

export function describeUpload(
  filename: string,
  claimedType: string | undefined,
  prefix: string
): StoredUpload {
  if (!PREFIX.test(prefix)) throw new AttachmentError("Bad upload prefix.")
  const name = sanitizeFileName(filename)
  const storedName = `${prefix}-${name}`
  const path = uploadPathForName(storedName)
  if (!path) throw new AttachmentError("Couldn't store that file.")
  return { name, storedName, mediaType: mediaTypeFor(name, claimedType), path }
}

export function parseAttachmentData(value: unknown): Attachment | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  const { name, storedName, mediaType, size, path, agentId } = data
  if (typeof name !== "string" || name !== sanitizeFileName(name)) return null
  if (typeof storedName !== "string" || !storedName.endsWith(`-${name}`)) return null
  const prefix = storedName.slice(0, storedName.length - name.length - 1)
  if (!PREFIX.test(prefix)) return null
  const canonical = uploadPathForName(storedName)
  if (!canonical || path !== canonical) return null
  if (typeof mediaType !== "string" || mediaType !== mediaTypeFor(storedName)) return null
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 0 ||
    size > MAX_FILE_BYTES
  ) {
    return null
  }
  if (typeof agentId !== "string" || !isAgentId(agentId)) return null
  return { name, storedName, mediaType, size, path: canonical, agentId }
}

type UserPart =
  { type: "text"; text: string } | { type: "data-attachment"; data: Attachment }

export function sanitizeUserParts(
  parts: unknown
): { parts: UserPart[] } | { error: string } {
  if (!Array.isArray(parts) || parts.length === 0) return { error: "Message is empty." }
  const out: UserPart[] = []
  let files = 0
  let text = ""
  for (const part of parts) {
    if (!part || typeof part !== "object") return { error: "Malformed message." }
    const type = (part as { type?: unknown }).type
    if (type === "text") {
      const value = (part as { text?: unknown }).text
      if (typeof value !== "string") return { error: "Malformed message." }
      text += value
      if (value.length > 0) out.push({ type: "text", text: value })
      continue
    }
    if (type === "data-attachment") {
      const data = parseAttachmentData((part as { data?: unknown }).data)
      if (!data) return { error: "That attachment isn't valid." }
      files++
      if (files > MAX_FILES_PER_MESSAGE) {
        return { error: `You can attach up to ${MAX_FILES_PER_MESSAGE} files.` }
      }
      out.push({ type: "data-attachment", data })
      continue
    }
    return { error: "Malformed message." }
  }
  if (!text.trim() && files === 0) return { error: "Message is empty." }
  if (text.length > 100_000) return { error: "Message is too long." }
  return { parts: out }
}

export function attachmentNote(files: Attachment[]) {
  const lines = files.map(
    (file) =>
      `- ${file.name} (${file.mediaType}, ${formatBytes(file.size)}) at ${file.path}`
  )
  return `Attached files are on your workstation. Read them with fs_read or the shell; do not assume their contents.\n${lines.join("\n")}`
}

export function attachmentSummary(parts: ReadonlyArray<{ type: string }>) {
  const names = parts.flatMap((part) => {
    if (part.type !== "data-attachment") return []
    const name = (part as { data?: { name?: unknown } }).data?.name
    return typeof name === "string" ? [name] : []
  })
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]
  return `${names[0]} and ${names.length - 1} more`
}

type NotePart = { type: "text"; text: string }
type FilePart = { type: "file"; mediaType: string; filename?: string; url: string }

export async function presentAttachments<
  T extends { role: string; parts: readonly { type: string }[] },
>(
  messages: readonly T[],
  spec: string,
  readImage: (agentId: string, workstationPath: string) => Promise<Uint8Array | null>
): Promise<T[]> {
  const vision = supportsImageInput(spec)
  const prepared: T[] = []
  for (const message of messages) {
    if (message.role !== "user") {
      prepared.push(message)
      continue
    }
    const files = message.parts.flatMap((part) => {
      if (part.type !== "data-attachment") return []
      const data = parseAttachmentData((part as { data?: unknown }).data)
      return data ? [data] : []
    })
    if (files.length === 0) {
      prepared.push(message)
      continue
    }
    const parts: Array<(typeof message.parts)[number] | NotePart | FilePart> = [
      ...message.parts,
      { type: "text", text: attachmentNote(files) },
    ]
    if (vision) {
      for (const file of files) {
        if (!isImageMedia(file.mediaType) || !isInsideUploads(file.path)) continue
        const bytes = await readImage(file.agentId, file.path)
        if (!bytes || bytes.byteLength === 0) continue
        parts.push({
          type: "file",
          mediaType: file.mediaType,
          filename: file.name,
          url: `data:${file.mediaType};base64,${toBase64(bytes)}`,
        })
      }
    }
    prepared.push({ ...message, parts })
  }
  return prepared
}

export function omitImagesForModel<T extends { role: string; content: unknown }>(
  messages: T[],
  spec: string
): T[] {
  if (supportsImageInput(spec)) return messages
  return messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return message
    const content = message.content.filter((part) => !isModelImagePart(part))
    if (content.length === message.content.length) return message
    return { ...message, content }
  })
}

function isModelImagePart(part: unknown) {
  if (!part || typeof part !== "object") return false
  const record = part as { type?: unknown; mediaType?: unknown }
  if (record.type === "image") return true
  return (
    record.type === "file" &&
    typeof record.mediaType === "string" &&
    record.mediaType.startsWith("image/")
  )
}

function toBase64(bytes: Uint8Array) {
  const chunk = 0x2000
  let binary = ""
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function filenameFromDisposition(header: string) {
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header)
  if (star) {
    let raw = star[1].trim()
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1)
    const encoded = raw.includes("''") ? raw.slice(raw.indexOf("''") + 2) : raw
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header)
  if (quoted) return quoted[1]
  const plain = /filename\s*=\s*([^;]+)/i.exec(header)
  if (!plain) return null
  return plain[1].trim()
}

type MultipartFile = { filename: string; mediaType: string }
type MultipartSink = {
  write: (chunk: Uint8Array) => Promise<void>
  close: () => Promise<void>
}

export async function parseMultipart(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  options: {
    maxFiles: number
    maxBytes: number
    onField: (name: string, value: string) => void
    onFile: (file: MultipartFile) => MultipartSink
  }
) {
  const boundary = multipartBoundary(contentType)
  if (!boundary) throw new AttachmentError("Upload is not multipart.")
  const decoder = new TextDecoder()
  const firstDelim = textBytes(`--${boundary}`)
  const nextDelim = textBytes(`\r\n--${boundary}`)
  const headerEnd = textBytes("\r\n\r\n")
  const crlf = textBytes("\r\n")
  const dashDash = textBytes("--")

  let buf = new Uint8Array(0)
  let mode: "preamble" | "headers" | "data" | "after" = "preamble"
  let sink: MultipartSink | null = null
  let fileBytes = 0
  let filename = "file"
  let isFile = false
  let fieldName = ""
  let fieldBytes = 0
  const fieldChunks: Uint8Array[] = []
  let files = 0
  let ended = false

  const fail = (message: string) => {
    throw new AttachmentError(message)
  }

  const emit = async (bytes: Uint8Array) => {
    if (bytes.byteLength === 0) return
    if (isFile) {
      if (fileBytes + bytes.byteLength > options.maxBytes) {
        fail(
          `"${sanitizeFileName(filename)}" is larger than ${formatBytes(options.maxBytes)}.`
        )
      }
      fileBytes += bytes.byteLength
      await sink?.write(bytes)
      return
    }
    fieldBytes += bytes.byteLength
    if (fieldBytes > 1024) fail("Upload field is too large.")
    fieldChunks.push(bytes)
  }

  const pump = async (chunk: Uint8Array | undefined, done: boolean) => {
    if (ended) return
    if (chunk && chunk.byteLength > 0) buf = concatBytes(buf, chunk)
    while (!ended) {
      if (mode === "preamble") {
        const at = indexOfBytes(buf, firstDelim)
        if (at === -1) {
          if (buf.length > firstDelim.length) {
            buf = buf.slice(buf.length - (firstDelim.length - 1))
          }
          if (done) fail("Malformed upload.")
          return
        }
        buf = buf.slice(at + firstDelim.length)
        mode = "after"
        continue
      }
      if (mode === "after") {
        if (buf.length < 2) {
          if (done) fail("Malformed upload.")
          return
        }
        if (startsWithBytes(buf, dashDash)) {
          ended = true
          return
        }
        if (!startsWithBytes(buf, crlf)) fail("Malformed upload.")
        buf = buf.slice(2)
        mode = "headers"
        continue
      }
      if (mode === "headers") {
        const at = indexOfBytes(buf, headerEnd)
        if (at === -1) {
          if (buf.length > 16 * 1024) fail("Upload headers are too large.")
          if (done) fail("Malformed upload.")
          return
        }
        const headerText = decoder.decode(buf.slice(0, at))
        buf = buf.slice(at + headerEnd.length)
        const headers = headerFields(headerText)
        const disposition = headers["content-disposition"] ?? ""
        const claimed = headers["content-type"] ?? ""
        const found = filenameFromDisposition(disposition)
        if (found != null) {
          files++
          if (files > options.maxFiles) {
            const noun = options.maxFiles === 1 ? "file" : "files"
            fail(`You can attach up to ${options.maxFiles} ${noun}.`)
          }
          filename = found
          isFile = true
          fileBytes = 0
          sink = options.onFile({ filename: found, mediaType: claimed })
        } else {
          isFile = false
          sink = null
          fieldName = fieldNameFrom(disposition)
          fieldBytes = 0
          fieldChunks.length = 0
        }
        mode = "data"
        continue
      }
      const at = indexOfBytes(buf, nextDelim)
      if (at === -1) {
        const keep = nextDelim.length - 1
        if (buf.length > keep) {
          const piece = buf.slice(0, buf.length - keep)
          buf = buf.slice(buf.length - keep)
          await emit(piece)
          continue
        }
        if (done) fail("Malformed upload.")
        return
      }
      await emit(buf.slice(0, at))
      buf = buf.slice(at + nextDelim.length)
      if (isFile) await sink?.close()
      else {
        const joined = fieldChunks.reduce(
          (acc, chunk) => concatBytes(acc, chunk),
          new Uint8Array(0)
        )
        options.onField(fieldName, decoder.decode(joined))
      }
      sink = null
      mode = "after"
    }
  }

  const reader = body.getReader()
  try {
    while (!ended) {
      const { done, value } = await reader.read()
      await pump(value, done)
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
  if (!ended) throw new AttachmentError("Malformed upload.")
}

function multipartBoundary(contentType: string) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const boundary = (match?.[1] ?? match?.[2])?.trim()
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) return null
  return boundary
}

function headerFields(headerText: string) {
  const fields: Record<string, string> = {}
  for (const line of headerText.split("\r\n")) {
    const split = line.indexOf(":")
    if (split <= 0) continue
    fields[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim()
  }
  return fields
}

function fieldNameFrom(disposition: string) {
  const quoted = /name\s*=\s*"([^"]*)"/i.exec(disposition)
  if (quoted) return quoted[1]
  const plain = /name\s*=\s*([^;]+)/i.exec(disposition)
  return plain?.[1]?.trim() ?? ""
}

function textBytes(value: string) {
  return new TextEncoder().encode(value)
}

function concatBytes(first: Uint8Array, ...rest: Uint8Array[]) {
  const parts = [first, ...rest]
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function startsWithBytes(buf: Uint8Array, needle: Uint8Array) {
  if (buf.length < needle.length) return false
  for (let index = 0; index < needle.length; index++) {
    if (buf[index] !== needle[index]) return false
  }
  return true
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0) {
  if (needle.length === 0 || hay.length < needle.length) return -1
  const last = hay.length - needle.length
  for (let index = from; index <= last; index++) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset++) {
      if (hay[index + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) return index
  }
  return -1
}
