// Photos and files a person sends to the Telegram bot. The bytes are untrusted:
// they are streamed to disk and copied into the agent's workstation, never
// parsed or executed. The bot token is never copied into an error string.

import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { finished } from "node:stream/promises"

import type { FileUIPart } from "ai"

import { getSetting } from "@/lib/config"
import { dockerRaw, dockerReason } from "@/lib/docker"
import { parseModelSpec } from "@/lib/providers/catalog"
import { ensureWorkstation } from "@/lib/workstation"

export const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024
export const MAX_UPLOAD_NAME = 80
export const GET_FILE_TIMEOUT_MS = 20_000
export const DOWNLOAD_TIMEOUT_MS = 60_000
export const UPLOADS_DIR = "/home/xiryn/uploads"

export const VOICE_NOTE_REPLY =
  "Voice notes aren't supported yet. They need a speech-to-text provider. Send a text message, a photo, or a file instead."

export const UNSUPPORTED_REPLY =
  "I can take text, photos, and files. That kind of message isn't supported."

export const DOWNLOAD_FAILED_REPLY =
  "I couldn't download that file from Telegram. Try sending it again."

export const DOWNLOAD_TIMEOUT_REPLY =
  "Downloading that file timed out. Try a smaller file or send it again."

export const SAVE_FAILED_REPLY =
  "I couldn't save that file on the agent's workstation. Check that Docker is running and try again."

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "text/plain": ".txt",
}

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/
const NOT_IMAGE_MODEL =
  /(embed|whisper|tts|transcri|dall-e|realtime|moderation|rerank|guard)/i
const VISION_HINT = /llava|bakllava|moondream|vision|pixtral|gemini|claude/i

export type TelegramFileRef = {
  file_id: string
  file_unique_id?: string
  file_size?: number
  file_name?: string
  mime_type?: string
  width?: number
  height?: number
  duration?: number
}

export type TelegramInboundMessage = {
  text?: string
  caption?: string
  photo?: TelegramFileRef[]
  document?: TelegramFileRef
  video?: TelegramFileRef
  audio?: TelegramFileRef
  voice?: TelegramFileRef
  video_note?: TelegramFileRef
  animation?: TelegramFileRef
  sticker?: unknown
  contact?: unknown
  location?: unknown
  venue?: unknown
  poll?: unknown
  dice?: unknown
}

type FileKind = "photo" | "document" | "video" | "audio"

export type InboundPlan =
  | { action: "ignored"; reason: "not-owner" }
  | { action: "text" }
  | { action: "voice" }
  | { action: "unsupported" }
  | { action: "too-large"; bytes?: number; name: string }
  | {
      action: "file"
      file: {
        kind: FileKind
        fileId: string
        fileName: string
        mimeType: string
        fileSize?: number
        caption?: string
      }
    }

export type InboundResult =
  | { action: "ignored"; reason: "not-owner" }
  | { action: "text" }
  | { action: "voice"; message: string }
  | { action: "unsupported"; message: string }
  | { action: "too-large"; message: string; bytes?: number }
  | { action: "failed"; message: string; detail?: string }
  | {
      action: "saved"
      userText: string
      fileParts: FileUIPart[]
      path: string
      bytes: number
      mimeType: string
      name: string
    }

export type UploadSave = (input: {
  agentId: string
  uploadName: string
  source: Readable
  bytes: number
}) => Promise<{ path: string }>

type TgFileInfo = {
  file_id: string
  file_unique_id?: string
  file_size?: number
  file_path?: string
}

export class InboundFileError extends Error {
  readonly code: "too-large" | "unavailable" | "timeout"
  readonly detail?: string
  readonly bytes?: number

  constructor(
    message: string,
    code: "too-large" | "unavailable" | "timeout",
    detail?: string,
    bytes?: number
  ) {
    super(message)
    this.name = "InboundFileError"
    this.code = code
    this.detail = detail
    this.bytes = bytes
  }
}

export function redactSecret(text: string, secret: string) {
  if (!secret) return text
  let out = text.split(secret).join("[redacted]")
  const encoded = encodeURIComponent(secret)
  if (encoded && encoded !== secret) out = out.split(encoded).join("[redacted]")
  return out
}

function safeDetail(token: string, error: unknown) {
  const raw =
    typeof error === "string" ? error : error instanceof Error ? error.message : ""
  if (!raw) return undefined
  const cleaned = redactSecret(raw, token).slice(0, 300)
  if (!token) return cleaned
  if (cleaned.includes(token) || cleaned.includes(encodeURIComponent(token)))
    return undefined
  return cleaned
}

export function describeBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function tooLargeReply(bytes?: number) {
  const limit = "20 MB"
  if (typeof bytes === "number" && bytes > TELEGRAM_FILE_LIMIT) {
    return `That file is ${describeBytes(bytes)}, which is over the ${limit} limit Telegram's bot API allows. Send a smaller file.`
  }
  return `That file is larger than ${limit}, which is the most Telegram's bot API will send. Send a smaller file.`
}

export function composeUserText(
  caption: string | undefined,
  file: { name: string; mime: string; bytes: number; path: string }
) {
  const note = `The user sent a file: ${file.name} (${file.mime}, ${describeBytes(file.bytes)}) saved at ${file.path}`
  const cap = caption?.trim()
  return cap ? `${cap}\n\n${note}` : note
}

// Last path segment only, then drop control characters and every ".." so a
// name like "../../etc/passwd" cannot leave the uploads folder.
export function sanitizeUploadName(input: string, fallback = "file") {
  const segment = input.replace(/\\/g, "/").split("/").pop() ?? ""
  let name = segment.replace(/[\u0000-\u001f\u007f]/g, "")
  while (name.includes("..")) name = name.replaceAll("..", "")
  name = name.trim()
  if (!name || /^\.+$/.test(name)) name = fallback
  if (name.length <= MAX_UPLOAD_NAME) return name
  const ext = path.posix.extname(name).slice(0, 16)
  const stem = name.slice(0, Math.max(1, MAX_UPLOAD_NAME - ext.length))
  const trimmed = `${stem}${ext}`
  return trimmed.length <= MAX_UPLOAD_NAME ? trimmed : trimmed.slice(0, MAX_UPLOAD_NAME)
}

export function uniqueUploadName(raw: string, mime?: string) {
  let safe = sanitizeUploadName(raw)
  if (mime && !path.posix.extname(safe)) {
    const ext = EXT_FOR_MIME[mime.toLowerCase()]
    if (ext) {
      const withExt = `${safe}${ext}`
      safe = withExt.length <= MAX_UPLOAD_NAME ? withExt : safe
    }
  }
  const prefix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`
  return `${prefix}-${safe}`
}

export function workstationUploadPath(fileName: string) {
  if (
    !fileName ||
    fileName !== path.posix.basename(fileName) ||
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(fileName) ||
    fileName.length > MAX_UPLOAD_NAME + 40
  ) {
    throw new Error("Unsafe upload name")
  }
  return `${UPLOADS_DIR}/${fileName}`
}

function captionOf(message: TelegramInboundMessage) {
  const value = (message.caption ?? message.text ?? "").trim()
  return value || undefined
}

function largestPhoto(photos: TelegramFileRef[]) {
  const sized = photos.filter((photo) => typeof photo.file_size === "number")
  if (sized.length > 0) {
    return sized.reduce((best, photo) =>
      (photo.file_size ?? 0) > (best.file_size ?? 0) ? photo : best
    )
  }
  return photos[photos.length - 1]
}

function asFile(
  kind: FileKind,
  file: TelegramFileRef | undefined,
  message: TelegramInboundMessage,
  fallbackMime: string,
  fallbackName: string
): InboundPlan | null {
  if (!file?.file_id) return null
  const mimeType = file.mime_type?.trim() || fallbackMime
  const fileName = file.file_name?.trim() || fallbackName
  if (typeof file.file_size === "number" && file.file_size > TELEGRAM_FILE_LIMIT) {
    return {
      action: "too-large",
      bytes: file.file_size,
      name: sanitizeUploadName(fileName),
    }
  }
  return {
    action: "file",
    file: {
      kind,
      fileId: file.file_id,
      fileName,
      mimeType,
      fileSize: file.file_size,
      caption: captionOf(message),
    },
  }
}

export function planInbound(
  message: TelegramInboundMessage,
  isOwner: boolean
): InboundPlan {
  // A file from anyone but the paired owner is not downloaded, even when the
  // message carries a file id.
  if (!isOwner) return { action: "ignored", reason: "not-owner" }
  if (message.voice?.file_id) return { action: "voice" }

  const photo = message.photo?.length ? largestPhoto(message.photo) : undefined
  const chosen =
    asFile("photo", photo, message, "image/jpeg", "photo.jpg") ??
    asFile(
      "document",
      message.document,
      message,
      "application/octet-stream",
      "document"
    ) ??
    asFile("video", message.video, message, "video/mp4", "video.mp4") ??
    asFile("audio", message.audio, message, "audio/mpeg", "audio") ??
    asFile("video", message.video_note, message, "video/mp4", "video.mp4") ??
    asFile(
      "document",
      message.animation,
      message,
      message.animation?.mime_type?.trim() || "application/octet-stream",
      message.animation?.file_name?.trim() || "animation"
    )

  if (chosen) return chosen
  if (
    message.sticker ||
    message.contact ||
    message.location ||
    message.venue ||
    message.poll ||
    message.dice
  ) {
    return { action: "unsupported" }
  }
  return { action: "text" }
}

// Vision is not a flag on the model object. Attach an image part only for
// providers whose chat models accept images, or when the id itself says so.
// A text-only model still gets the workstation path.
export function modelAcceptsImageInput(spec: string | null | undefined) {
  if (!spec) return false
  const parsed = parseModelSpec(spec)
  if (!parsed) return false
  if (NOT_IMAGE_MODEL.test(parsed.model)) return false
  switch (parsed.provider) {
    case "openai":
    case "anthropic":
    case "google":
    case "xai":
      return true
    case "bedrock":
      return /claude|nova-(pro|lite|premier)/i.test(parsed.model)
    default:
      return VISION_HINT.test(parsed.model)
  }
}

function apiBaseOf(given?: string) {
  const value = given ?? getSetting("telegram.apiUrl") ?? "https://api.telegram.org"
  return value.replace(/\/+$/, "")
}

function isTimeout(error: unknown, signal: AbortSignal) {
  if (signal.aborted) return true
  if (!error || typeof error !== "object") return false
  const name = (error as { name?: string }).name
  return name === "TimeoutError" || name === "AbortError"
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  // A referenced timer, so a download still aborts when nothing else is
  // keeping the process awake. AbortSignal.timeout's timer does not.
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out", "TimeoutError"))
  }, timeoutMs)
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  }
}

async function telegramFetch(
  token: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch
) {
  const timed = timeoutSignal(timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: timed.signal, cache: "no-store" })
  } catch (error) {
    const timedOut = isTimeout(error, timed.signal)
    throw new InboundFileError(
      timedOut ? DOWNLOAD_TIMEOUT_REPLY : DOWNLOAD_FAILED_REPLY,
      timedOut ? "timeout" : "unavailable",
      safeDetail(token, error)
    )
  } finally {
    timed.cancel()
  }
}

function remotePathOk(filePath: string) {
  if (
    !filePath ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    filePath.includes("..")
  ) {
    return false
  }
  return filePath.split("/").every((part) => part && part !== "." && part !== "..")
}

async function writeCapped(source: Readable, dest: string, maxBytes: number) {
  const out = createWriteStream(dest)
  // finished() reports the same failure. This listener only keeps a late
  // error from crashing the process after the stream was destroyed.
  out.on("error", () => {})
  let seen = 0
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      seen += buf.length
      if (seen > maxBytes) {
        source.destroy()
        out.destroy()
        throw new InboundFileError(tooLargeReply(), "too-large")
      }
      if (!out.write(buf)) await once(out, "drain")
    }
    const done = finished(out)
    out.end()
    await done
    return seen
  } catch (error) {
    out.destroy()
    await unlink(dest).catch(() => {})
    throw error
  }
}

export async function downloadTelegramFile(options: {
  token: string
  fileId: string
  dest: string
  apiBase?: string
  maxBytes?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}) {
  const token = options.token
  const fetchImpl = options.fetchImpl ?? fetch
  const base = apiBaseOf(options.apiBase)
  const maxBytes = options.maxBytes ?? TELEGRAM_FILE_LIMIT
  const metadataTimeout = options.timeoutMs ?? GET_FILE_TIMEOUT_MS
  const bodyTimeout = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS

  const meta = await telegramFetch(
    token,
    `${base}/bot${token}/getFile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: options.fileId }),
    },
    metadataTimeout,
    fetchImpl
  )
  const json = (await meta.json().catch(() => null)) as {
    ok?: boolean
    description?: string
    result?: TgFileInfo
  } | null
  if (!json?.ok || !json.result) {
    const description = json?.description ?? ""
    if (/too big|too large/i.test(description)) {
      throw new InboundFileError(
        tooLargeReply(),
        "too-large",
        safeDetail(token, description)
      )
    }
    throw new InboundFileError(
      DOWNLOAD_FAILED_REPLY,
      "unavailable",
      safeDetail(token, description || `Telegram answered ${meta.status}`)
    )
  }
  if (typeof json.result.file_size === "number" && json.result.file_size > maxBytes) {
    throw new InboundFileError(tooLargeReply(json.result.file_size), "too-large")
  }
  const remote = json.result.file_path
  if (!remote || !remotePathOk(remote)) {
    throw new InboundFileError(DOWNLOAD_FAILED_REPLY, "unavailable")
  }

  const encoded = remote
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
  const body = await telegramFetch(
    token,
    `${base}/file/bot${token}/${encoded}`,
    { method: "GET" },
    bodyTimeout,
    fetchImpl
  )
  if (!body.ok || !body.body) {
    const snippet = (await body.text().catch(() => "")).slice(0, 300)
    throw new InboundFileError(
      DOWNLOAD_FAILED_REPLY,
      "unavailable",
      safeDetail(token, snippet || `Telegram answered ${body.status}`)
    )
  }
  const declared = Number(body.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await body.body.cancel().catch(() => {})
    throw new InboundFileError(tooLargeReply(declared), "too-large")
  }
  const bytes = await writeCapped(
    Readable.fromWeb(body.body as import("node:stream/web").ReadableStream<Uint8Array>),
    options.dest,
    maxBytes
  )
  return { bytes }
}

async function imageFilePart(
  localPath: string,
  mediaType: string,
  filename: string,
  modelSpec: string | null
): Promise<FileUIPart[]> {
  if (!IMAGE_MIME.test(mediaType) || !modelAcceptsImageInput(modelSpec)) return []
  const bytes = await readFile(localPath)
  if (bytes.length === 0) return []
  return [
    {
      type: "file",
      mediaType,
      filename,
      url: `data:${mediaType};base64,${bytes.toString("base64")}`,
    },
  ]
}

async function saveUploadInWorkstation(input: {
  agentId: string
  uploadName: string
  source: Readable
  bytes: number
}) {
  const dest = workstationUploadPath(input.uploadName)
  const container = await ensureWorkstation(input.agentId)
  // noclobber: a unique prefix should already make this a new path
  const result = await dockerRaw(
    [
      "exec",
      "--interactive",
      container,
      "sh",
      "-c",
      'mkdir -p -- /home/xiryn/uploads && set -C && cat > "$1"',
      "sh",
      dest,
    ],
    { input: input.source, timeoutMs: 90_000 }
  )
  if (result.exitCode !== 0) {
    throw new Error(dockerReason(result.stderr) || "Could not save the upload")
  }
  return { path: dest }
}

function failureResult(token: string, error: unknown, fallback: string): InboundResult {
  if (error instanceof InboundFileError) {
    if (error.code === "too-large") {
      return { action: "too-large", message: error.message, bytes: error.bytes }
    }
    return {
      action: "failed",
      message: error.message,
      detail: safeDetail(token, error.detail ?? ""),
    }
  }
  return { action: "failed", message: fallback, detail: safeDetail(token, error) }
}

export async function receiveInboundFile(options: {
  isOwner: boolean
  message: TelegramInboundMessage
  token: string
  agentId: string
  modelSpec: string | null
  apiBase?: string
  maxBytes?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  save?: UploadSave
}): Promise<InboundResult> {
  const plan = planInbound(options.message, options.isOwner)
  if (plan.action === "ignored" || plan.action === "text") return plan
  if (plan.action === "voice") return { action: "voice", message: VOICE_NOTE_REPLY }
  if (plan.action === "unsupported") {
    return { action: "unsupported", message: UNSUPPORTED_REPLY }
  }
  if (plan.action === "too-large") {
    return {
      action: "too-large",
      message: tooLargeReply(plan.bytes),
      bytes: plan.bytes,
    }
  }

  const dir = await mkdtemp(path.join(tmpdir(), "xiryn-tg-"))
  const dest = path.join(dir, "payload")
  try {
    let downloaded: { bytes: number }
    try {
      downloaded = await downloadTelegramFile({
        token: options.token,
        fileId: plan.file.fileId,
        dest,
        apiBase: options.apiBase,
        maxBytes: options.maxBytes,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      })
    } catch (error) {
      return failureResult(options.token, error, DOWNLOAD_FAILED_REPLY)
    }

    const uploadName = uniqueUploadName(plan.file.fileName, plan.file.mimeType)
    const save = options.save ?? saveUploadInWorkstation
    const source = createReadStream(dest)
    let saved: { path: string }
    try {
      saved = await save({
        agentId: options.agentId,
        uploadName,
        source,
        bytes: downloaded.bytes,
      })
    } catch (error) {
      return failureResult(options.token, error, SAVE_FAILED_REPLY)
    } finally {
      if (!source.readableEnded) {
        source.on("error", () => {})
        source.destroy()
      }
    }

    // The file is already on the workstation. If the image copy for the model
    // can't be read, the path in the message is still enough.
    let fileParts: FileUIPart[] = []
    try {
      fileParts = await imageFilePart(
        dest,
        plan.file.mimeType,
        uploadName,
        options.modelSpec
      )
    } catch {
      fileParts = []
    }
    return {
      action: "saved",
      userText: composeUserText(plan.file.caption, {
        name: uploadName,
        mime: plan.file.mimeType,
        bytes: downloaded.bytes,
        path: saved.path,
      }),
      fileParts,
      path: saved.path,
      bytes: downloaded.bytes,
      mimeType: plan.file.mimeType,
      name: uploadName,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
