import assert from "node:assert/strict"
import { test } from "node:test"

import { supportsImageInput } from "./providers/catalog"
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  UPLOADS_DIR,
  attachmentNote,
  describeUpload,
  filenameFromDisposition,
  formatBytes,
  isInsideUploads,
  mediaTypeFor,
  omitImagesForModel,
  parseMultipart,
  presentAttachments,
  sanitizeFileName,
  sanitizeUserParts,
  uploadPathForName,
} from "./attachments"

test("sanitizeFileName strips paths, traversal, control characters and caps length", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd")
  assert.equal(sanitizeFileName("..\\..\\windows\\system32\\evil.exe"), "evil.exe")
  assert.equal(sanitizeFileName("foo/../../bar.txt"), "bar.txt")
  assert.equal(sanitizeFileName("....//....//etc/passwd"), "passwd")
  assert.equal(sanitizeFileName("a\u0000b.txt"), "ab.txt")
  assert.equal(sanitizeFileName("a\nb\rc.txt"), "abc.txt")
  assert.equal(sanitizeFileName(".."), "file")
  assert.equal(sanitizeFileName(""), "file")
  assert.equal(sanitizeFileName("foo..bar.txt"), "foobar.txt")
  assert.equal(sanitizeFileName("notes.txt"), "notes.txt")
  const long = `${"a".repeat(200)}.txt`
  const capped = sanitizeFileName(long)
  assert.ok(capped.length <= 80)
  assert.ok(capped.endsWith(".txt"))
  assert.equal(capped.includes("/"), false)
  assert.equal(capped.includes(".."), false)
})

test("describeUpload builds a unique path inside the uploads folder", () => {
  const upload = describeUpload("../../etc/passwd", "text/html", "abc1234567")
  assert.equal(upload.name, "passwd")
  assert.equal(upload.storedName, "abc1234567-passwd")
  assert.equal(upload.path, `${UPLOADS_DIR}/abc1234567-passwd`)
  assert.equal(upload.mediaType, "application/octet-stream")
  assert.equal(isInsideUploads(upload.path), true)

  const text = describeUpload("..\\..\\secret.txt", "text/html", "abc1234567")
  assert.equal(text.name, "secret.txt")
  assert.equal(text.mediaType, "text/plain")
  const again = describeUpload("secret.txt", "text/plain", "zzzzzzzzzz")
  assert.notEqual(text.storedName, again.storedName)
})

test("size and count caps reject oversized batches", () => {
  const one = describeUpload("ok.txt", "text/plain", "abc1234567")
  const parts = [
    { type: "text" as const, text: "hi" },
    {
      type: "data-attachment" as const,
      data: { ...one, size: MAX_FILE_BYTES, agentId: "agent123456" },
    },
  ]
  const ok = sanitizeUserParts(parts)
  assert.equal("error" in ok, false)

  const huge = sanitizeUserParts([
    {
      type: "data-attachment",
      data: { ...one, size: MAX_FILE_BYTES + 1, agentId: "agent123456" },
    },
  ])
  assert.equal("error" in huge, true)

  const tooMany = sanitizeUserParts(
    Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, (_, index) => ({
      type: "data-attachment" as const,
      data: {
        ...describeUpload(
          `f${index}.txt`,
          "text/plain",
          `p${String(index).padStart(9, "0")}`
        ),
        size: 1,
        agentId: "agent123456",
      },
    }))
  )
  assert.equal("error" in tooMany, true)
  if ("error" in tooMany) assert.match(tooMany.error, /10/)
})

test("media types follow the extension and ignore active content types", () => {
  assert.equal(mediaTypeFor("notes.txt", "text/plain"), "text/plain")
  assert.equal(mediaTypeFor("notes.txt", "text/html"), "text/plain")
  assert.equal(mediaTypeFor("page.html", "text/html"), "application/octet-stream")
  assert.equal(mediaTypeFor("pic.svg", "image/svg+xml"), "application/octet-stream")
  assert.equal(mediaTypeFor("pic.png", "image/png"), "image/png")
  assert.equal(mediaTypeFor("pic.png", "image/jpeg"), "image/png")
  assert.equal(mediaTypeFor("pic.jpg"), "image/jpeg")
  assert.equal(mediaTypeFor("pic.jpeg", "image/jpeg; charset=binary"), "image/jpeg")
  assert.equal(mediaTypeFor("README.MD"), "text/markdown")
  assert.equal(mediaTypeFor("data.json"), "application/json")
  assert.equal(mediaTypeFor("no-extension", "image/png"), "application/octet-stream")
  assert.equal(mediaTypeFor("file"), "application/octet-stream")
})

test("upload paths must be a single file inside the uploads folder", () => {
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/abc1234567-notes.txt`), true)
  assert.equal(
    uploadPathForName("abc1234567-notes.txt"),
    `${UPLOADS_DIR}/abc1234567-notes.txt`
  )
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/../.ssh/id_rsa`), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/foo/../../etc/passwd`), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/%2e%2e/%2e%2e/etc/passwd`), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/foo/..%2f..%2fetc/passwd`), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/foo.txt/../../etc/passwd`), false)
  assert.equal(isInsideUploads("uploads/file.txt"), false)
  assert.equal(isInsideUploads(UPLOADS_DIR), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/nested/file.txt`), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/bad\\file.txt`), false)
  assert.equal(isInsideUploads(`${UPLOADS_DIR}/bad\u0000.txt`), false)
  assert.equal(uploadPathForName("../etc/passwd"), null)
  assert.equal(uploadPathForName("foo/bar.txt"), null)
  assert.equal(uploadPathForName(""), null)
  assert.equal(uploadPathForName("abc1234567-foo..bar.txt"), null)

  const evil = sanitizeUserParts([
    {
      type: "data-attachment",
      data: {
        name: "passwd",
        storedName: "abc1234567-passwd",
        mediaType: "application/octet-stream",
        size: 4,
        path: "/etc/passwd",
        agentId: "agent123456",
      },
    },
  ])
  assert.equal("error" in evil, true)
})

test("image input is off unless the model is a known vision model", () => {
  assert.equal(supportsImageInput(null), false)
  assert.equal(supportsImageInput(undefined), false)
  assert.equal(supportsImageInput(""), false)
  assert.equal(supportsImageInput("not-a-spec"), false)
  assert.equal(supportsImageInput("ollama/llava"), false)
  assert.equal(supportsImageInput("lmstudio/qwen2.5vl"), false)
  assert.equal(supportsImageInput("custom/gpt-4o"), false)
  assert.equal(supportsImageInput("groq/meta-llama/llama-4-scout"), false)
  assert.equal(supportsImageInput("deepseek/deepseek-chat"), false)
  assert.equal(supportsImageInput("openai/gpt-3.5-turbo"), false)
  assert.equal(supportsImageInput("openai/whisper-1"), false)
  assert.equal(supportsImageInput("openai/o1-mini"), false)
  assert.equal(supportsImageInput("xai/grok-2"), false)
  assert.equal(supportsImageInput("mistral/mistral-large-latest"), false)
  assert.equal(supportsImageInput("openrouter/meta-llama/llama-3-70b"), false)
  assert.equal(supportsImageInput("bedrock/eu.amazon.nova-micro-v1:0"), false)
  assert.equal(supportsImageInput("google/imagen-3.0-generate-002"), false)

  assert.equal(supportsImageInput("openai/gpt-4o"), true)
  assert.equal(supportsImageInput("openai/gpt-4o-mini"), true)
  assert.equal(supportsImageInput("openai/gpt-6-luna"), true)
  assert.equal(supportsImageInput("anthropic/claude-sonnet-5-5"), true)
  assert.equal(supportsImageInput("anthropic/claude-3-haiku-20240307"), true)
  assert.equal(supportsImageInput("google/gemini-2.5-pro"), true)
  assert.equal(supportsImageInput("xai/grok-4"), true)
  assert.equal(supportsImageInput("xai/grok-2-vision-1212"), true)
  assert.equal(supportsImageInput("mistral/pixtral-large-latest"), true)
  assert.equal(supportsImageInput("openrouter/openai/gpt-4o"), true)
  assert.equal(supportsImageInput("openrouter/anthropic/claude-sonnet-4.6"), true)
  assert.equal(supportsImageInput("bedrock/eu.anthropic.claude-sonnet-4-6"), true)
  assert.equal(supportsImageInput("bedrock/eu.amazon.nova-pro-v1:0"), true)
  assert.equal(supportsImageInput("bedrock/eu.amazon.nova-lite-v1:0"), true)
})

test("the model note names the file and image bytes are only added for vision models", async () => {
  const image = describeUpload("shot.png", "image/png", "abc1234567")
  const text = describeUpload("notes.txt", "text/plain", "abc1234567")
  const messages = [
    {
      id: "m1",
      role: "user",
      parts: [
        { type: "text", text: "see this" },
        { type: "data-attachment", data: { ...image, size: 4, agentId: "agent123456" } },
        { type: "data-attachment", data: { ...text, size: 3, agentId: "agent123456" } },
      ],
    },
  ]
  let reads = 0
  const blind = await presentAttachments(messages, "ollama/qwen3.5", async () => {
    reads++
    return new Uint8Array([1, 2, 3, 4])
  })
  assert.equal(reads, 0)
  const blindParts = blind[0].parts
  assert.equal(
    blindParts.some((part) => part.type === "file"),
    false
  )
  const note = blindParts
    .flatMap((part) =>
      part.type === "text" && "text" in part && typeof part.text === "string"
        ? [part.text]
        : []
    )
    .join("\n")
  assert.match(note, /shot\.png/)
  assert.match(note, /image\/png/)
  assert.match(note, /notes\.txt/)
  assert.match(note, /text\/plain/)
  assert.match(note, new RegExp(text.path.replaceAll("/", "\\/")))
  assert.equal(messages[0].parts.length, 3)

  const seen = await presentAttachments(
    messages,
    "openai/gpt-4o",
    async (_agent, path) => (path.endsWith(".png") ? new Uint8Array([1, 2, 3, 4]) : null)
  )
  const files = seen[0].parts.filter((part) => part.type === "file")
  assert.equal(files.length, 1)
  assert.equal(files[0] && "mediaType" in files[0] && files[0].mediaType, "image/png")
  assert.equal(
    files[0] &&
      "url" in files[0] &&
      String(files[0].url).startsWith("data:image/png;base64,"),
    true
  )
})

test("unknown models drop user image parts and leave tool screenshots alone", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "hi" },
        { type: "file", mediaType: "image/png", data: "abc" },
        { type: "image", image: "abc" },
      ],
    },
    {
      role: "tool",
      content: [{ type: "file", mediaType: "image/jpeg", data: "screen" }],
    },
  ]
  const stripped = omitImagesForModel(messages, "custom/whatever")
  assert.deepEqual(stripped[0].content, [{ type: "text", text: "hi" }])
  assert.equal(stripped[1], messages[1])
  assert.equal(omitImagesForModel(messages, "openai/gpt-4o"), messages)
})

test("multipart parsing streams bytes, caps size and count, and keeps traversal in the filename", async () => {
  const boundary = "----xiryn"
  const body = multipartBody(
    [
      { name: "agentId", body: "agent123456" },
      {
        name: "file",
        filename: "../../notes.txt",
        type: "text/plain",
        body: "hello",
      },
    ],
    boundary
  )
  const files: { filename: string; bytes: Uint8Array }[] = []
  const fields: Record<string, string> = {}
  await parseMultipart(chunked(body, 5), `multipart/form-data; boundary=${boundary}`, {
    maxFiles: MAX_FILES_PER_MESSAGE,
    maxBytes: MAX_FILE_BYTES,
    onField(name, value) {
      fields[name] = value
    },
    onFile(file) {
      const chunks: Uint8Array[] = []
      return {
        async write(chunk) {
          chunks.push(chunk)
        },
        async close() {
          files.push({ filename: file.filename, bytes: concatBytes(chunks) })
        },
      }
    },
  })
  assert.equal(fields.agentId, "agent123456")
  assert.equal(files.length, 1)
  assert.equal(files[0].filename, "../../notes.txt")
  assert.equal(
    filenameFromDisposition('form-data; filename="../../etc/passwd"'),
    "../../etc/passwd"
  )
  assert.equal(new TextDecoder().decode(files[0].bytes), "hello")

  const big = multipartBody(
    [
      {
        name: "file",
        filename: "big.bin",
        type: "application/octet-stream",
        body: "0123456789abcdef",
      },
    ],
    boundary
  )
  let written = 0
  await assert.rejects(
    parseMultipart(chunked(big, 4), `multipart/form-data; boundary=${boundary}`, {
      maxFiles: 2,
      maxBytes: 10,
      onField() {},
      onFile() {
        return {
          async write(chunk) {
            written += chunk.byteLength
          },
          async close() {},
        }
      },
    }),
    /larger than/
  )
  assert.ok(written <= 10)

  const many = multipartBody(
    [
      { name: "file", filename: "a.txt", body: "a" },
      { name: "file", filename: "b.txt", body: "b" },
    ],
    boundary
  )
  await assert.rejects(
    parseMultipart(chunked(many, 7), `multipart/form-data; boundary=${boundary}`, {
      maxFiles: 1,
      maxBytes: 100,
      onField() {},
      onFile() {
        return { async write() {}, async close() {} }
      },
    }),
    /1 file/
  )
})

test("attachment note includes name, type, size and workstation path", () => {
  const file = {
    ...describeUpload("notes.txt", "text/plain", "abc1234567"),
    size: 1536,
    agentId: "agent123456",
  }
  const note = attachmentNote([file])
  assert.match(note, /notes\.txt/)
  assert.match(note, /text\/plain/)
  assert.match(note, new RegExp(formatBytes(1536).replace(".", "\\.")))
  assert.match(note, new RegExp(file.path.replaceAll("/", "\\/")))
})

function multipartBody(
  parts: { name: string; filename?: string; type?: string; body: string }[],
  boundary: string
) {
  const chunks: Uint8Array[] = []
  const enc = new TextEncoder()
  const push = (value: string) => chunks.push(enc.encode(value))
  for (const part of parts) {
    push(`--${boundary}\r\n`)
    const filename =
      part.filename != null ? `; filename="${part.filename.replaceAll('"', "")}"` : ""
    push(`Content-Disposition: form-data; name="${part.name}"${filename}\r\n`)
    if (part.type) push(`Content-Type: ${part.type}\r\n`)
    push("\r\n")
    push(part.body)
    push("\r\n")
  }
  push(`--${boundary}--\r\n`)
  return concatBytes(chunks)
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function chunked(bytes: Uint8Array, size: number) {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  })
}
