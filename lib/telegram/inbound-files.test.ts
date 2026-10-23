import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { test } from "node:test"

import { convertToModelMessages } from "ai"

import {
  MAX_UPLOAD_NAME,
  composeUserText,
  modelAcceptsImageInput,
  planInbound,
  receiveInboundFile,
  redactSecret,
  sanitizeUploadName,
  tooLargeReply,
  uniqueUploadName,
  workstationUploadPath,
  DOWNLOAD_FAILED_REPLY,
  VOICE_NOTE_REPLY,
  type TelegramInboundMessage,
} from "./inbound-files"

// Distinctive, but not a real credential. Assertions must not print it.
const TOKEN = "999:TELEGRAM_TEST_TOKEN"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function photoMessage(
  extra: Partial<TelegramInboundMessage> = {}
): TelegramInboundMessage {
  return {
    caption: "see this",
    photo: [
      { file_id: "small", width: 90, height: 90, file_size: 100 },
      { file_id: "large", width: 800, height: 600, file_size: 5000 },
    ],
    ...extra,
  }
}

test("a photo uses the largest size and keeps the caption", () => {
  const plan = planInbound(photoMessage(), true)
  assert.equal(plan.action, "file")
  if (plan.action !== "file") return
  assert.equal(plan.file.kind, "photo")
  assert.equal(plan.file.fileId, "large")
  assert.equal(plan.file.mimeType, "image/jpeg")
  assert.equal(plan.file.caption, "see this")
  assert.equal(plan.file.fileName, "photo.jpg")
})

test("a photo with no file sizes uses the last size Telegram sends", () => {
  const plan = planInbound(
    {
      photo: [
        { file_id: "first", width: 10, height: 10 },
        { file_id: "last", width: 20, height: 20 },
      ],
    },
    true
  )
  assert.equal(plan.action, "file")
  if (plan.action !== "file") return
  assert.equal(plan.file.fileId, "last")
})

test("a document keeps its name, type, and caption", () => {
  const plan = planInbound(
    {
      caption: "the spec",
      document: {
        file_id: "doc-1",
        file_name: "notes.pdf",
        mime_type: "application/pdf",
        file_size: 40,
      },
    },
    true
  )
  assert.equal(plan.action, "file")
  if (plan.action !== "file") return
  assert.equal(plan.file.kind, "document")
  assert.equal(plan.file.fileId, "doc-1")
  assert.equal(plan.file.fileName, "notes.pdf")
  assert.equal(plan.file.mimeType, "application/pdf")
  assert.equal(plan.file.caption, "the spec")
})

test("video and audio are saved as plain files", () => {
  const video = planInbound(
    {
      video: {
        file_id: "vid",
        file_name: "clip.mp4",
        mime_type: "video/mp4",
        file_size: 10,
      },
    },
    true
  )
  const audio = planInbound(
    {
      audio: {
        file_id: "aud",
        file_name: "song.mp3",
        mime_type: "audio/mpeg",
        file_size: 10,
      },
    },
    true
  )
  assert.equal(video.action, "file")
  assert.equal(audio.action, "file")
  if (video.action !== "file" || audio.action !== "file") return
  assert.equal(video.file.kind, "video")
  assert.equal(audio.file.kind, "audio")
  assert.equal(audio.file.mimeType, "audio/mpeg")
})

test("a voice note is not a file", () => {
  const plan = planInbound(
    { voice: { file_id: "voice-1", mime_type: "audio/ogg" } },
    true
  )
  assert.equal(plan.action, "voice")
})

test("stickers are refused without a file id to download", () => {
  const plan = planInbound({ sticker: { file_id: "stk" } }, true)
  assert.equal(plan.action, "unsupported")
  assert.equal("file" in plan, false)
})

test("plain text is left for the existing chat path", () => {
  assert.equal(planInbound({ text: "/help" }, true).action, "text")
})

test("a file from a chat that is not the paired owner is ignored", async () => {
  let fetched = false
  const plan = planInbound(photoMessage(), false)
  assert.equal(plan.action, "ignored")
  const result = await receiveInboundFile({
    isOwner: false,
    message: photoMessage(),
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: "openai/gpt-6-luna",
    apiBase: "http://telegram.test",
    fetchImpl: async () => {
      fetched = true
      return jsonResponse({ ok: false })
    },
    save: async () => {
      throw new Error("save should not run")
    },
  })
  assert.equal(result.action, "ignored")
  assert.equal(fetched, false)
})

test("upload names lose paths, control characters, and dot-dot", () => {
  assert.equal(sanitizeUploadName("../../etc/passwd"), "passwd")
  assert.equal(sanitizeUploadName("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe")
  assert.equal(sanitizeUploadName("foo/../../bar.txt"), "bar.txt")
  assert.equal(sanitizeUploadName("....//....//etc/passwd"), "passwd")
  assert.equal(sanitizeUploadName("my\u0000file\n.txt"), "myfile.txt")
  assert.equal(sanitizeUploadName("report..final.pdf"), "reportfinal.pdf")
  assert.equal(sanitizeUploadName(".."), "file")
  assert.equal(sanitizeUploadName("   "), "file")
  assert.equal(sanitizeUploadName("notes.pdf"), "notes.pdf")
  const long = sanitizeUploadName(`${"a".repeat(300)}.png`)
  assert.ok(long.length <= MAX_UPLOAD_NAME)
  assert.ok(long.endsWith(".png"))
  assert.equal(long.includes(".."), false)
})

test("saved names are unique, prefixed, and stay inside the uploads folder", () => {
  const raw = "../../etc/passwd"
  const a = uniqueUploadName(raw)
  const b = uniqueUploadName(raw)
  assert.notEqual(a, b)
  assert.equal(a.includes(".."), false)
  assert.equal(a.includes("/"), false)
  assert.equal(a.includes("\\"), false)
  assert.match(a, /-passwd$/)
  const dest = workstationUploadPath(a)
  assert.equal(dest, `/home/xiryn/uploads/${a}`)
  assert.throws(() => workstationUploadPath(`../${a}`))
  assert.throws(() => workstationUploadPath(`nested/${a}`))
})

test("a file Telegram already reports as over 20 MB is refused before any request", async () => {
  let fetched = false
  const huge = 20 * 1024 * 1024 + 1
  const result = await receiveInboundFile({
    isOwner: true,
    message: {
      document: {
        file_id: "big",
        file_name: "big.bin",
        mime_type: "application/octet-stream",
        file_size: huge,
      },
    },
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: null,
    apiBase: "http://telegram.test",
    fetchImpl: async () => {
      fetched = true
      return jsonResponse({ ok: false })
    },
  })
  assert.equal(result.action, "too-large")
  assert.equal(fetched, false)
  if (result.action !== "too-large") return
  assert.equal(result.message, tooLargeReply(huge))
  assert.equal(result.message.includes(TOKEN), false)
  assert.match(result.message, /20 MB/)
})

test("getFile reporting a size over the cap does not download the body", async () => {
  const calls: string[] = []
  const result = await receiveInboundFile({
    isOwner: true,
    message: { document: { file_id: "later-big", file_name: "later.bin" } },
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: null,
    apiBase: "http://telegram.test",
    maxBytes: 50,
    fetchImpl: async (url) => {
      const href = String(url)
      calls.push(href.includes("getFile") ? "getFile" : "body")
      return jsonResponse({
        ok: true,
        result: { file_id: "later-big", file_size: 51, file_path: "docs/later.bin" },
      })
    },
  })
  assert.equal(result.action, "too-large")
  assert.deepEqual(calls, ["getFile"])
})

test("a body over the cap stops streaming and is not saved", async () => {
  const total = 4_000
  const maxBytes = 100
  let sent = 0
  let saved = false
  const result = await receiveInboundFile({
    isOwner: true,
    message: { document: { file_id: "streamed", file_name: "blob.bin" } },
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: null,
    apiBase: "http://telegram.test",
    maxBytes,
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes("/getFile")) {
        return jsonResponse({
          ok: true,
          result: { file_id: "streamed", file_size: 10, file_path: "docs/blob.bin" },
        })
      }
      let cancelled = false
      const stream = new ReadableStream({
        pull(controller) {
          if (cancelled || sent >= total) {
            controller.close()
            return
          }
          const n = Math.min(64, total - sent)
          sent += n
          controller.enqueue(new Uint8Array(n))
        },
        cancel() {
          cancelled = true
        },
      })
      return new Response(stream)
    },
    save: async () => {
      saved = true
      return { path: "/home/xiryn/uploads/should-not" }
    },
  })
  assert.equal(result.action, "too-large")
  assert.equal(saved, false)
  assert.ok(sent < total)
  assert.ok(sent < 1_000)
  if (result.action === "too-large") assert.equal(result.message.includes(TOKEN), false)
})

test("a download failure never includes the bot token", async () => {
  const result = await receiveInboundFile({
    isOwner: true,
    message: {
      document: { file_id: "missing", file_name: "x.txt", mime_type: "text/plain" },
    },
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: null,
    apiBase: "http://telegram.test",
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes("/getFile")) {
        return jsonResponse({
          ok: false,
          description: `Bad Request: bot ${TOKEN} ${encodeURIComponent(TOKEN)}`,
          error_code: 400,
        })
      }
      throw new Error(`network down ${TOKEN} ${href}`)
    },
  })
  assert.equal(result.action, "failed")
  if (result.action !== "failed") return
  assert.equal(result.message, DOWNLOAD_FAILED_REPLY)
  assert.equal(result.message.includes(TOKEN), false)
  assert.equal((result.detail ?? "").includes(TOKEN), false)
  assert.equal((result.detail ?? "").includes(encodeURIComponent(TOKEN)), false)
})

test("a timed out download never includes the bot token", async () => {
  const result = await receiveInboundFile({
    isOwner: true,
    message: { document: { file_id: "slow", file_name: "slow.bin" } },
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: null,
    apiBase: "http://telegram.test",
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        const fail = () => reject(new Error(`timed out ${TOKEN}`))
        if (init?.signal?.aborted) fail()
        else init?.signal?.addEventListener("abort", fail)
      }),
  })
  assert.equal(result.action, "failed")
  if (result.action !== "failed") return
  assert.match(result.message, /timed out/i)
  assert.equal(result.message.includes(TOKEN), false)
  assert.equal((result.detail ?? "").includes(TOKEN), false)
})

test("redactSecret removes the token and its encoded form", () => {
  const raw = `see ${TOKEN} and ${encodeURIComponent(TOKEN)} and ${TOKEN}`
  const cleaned = redactSecret(raw, TOKEN)
  assert.equal(cleaned.includes(TOKEN), false)
  assert.equal(cleaned.includes(encodeURIComponent(TOKEN)), false)
})

test("a saved file streams to the workstation and the note names it", async () => {
  const chunks: Buffer[] = []
  let uploadName = ""
  const result = await receiveInboundFile({
    isOwner: true,
    message: {
      caption: "@Vega check the scan",
      document: {
        file_id: "pdf",
        file_name: "../../scans/../../lab.pdf",
        mime_type: "application/pdf",
        file_size: 5,
      },
    },
    token: TOKEN,
    agentId: "vega",
    modelSpec: "openai/gpt-6-luna",
    apiBase: "http://telegram.test",
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes("/getFile")) {
        return jsonResponse({
          ok: true,
          result: { file_id: "pdf", file_size: 5, file_path: "docs/lab.pdf" },
        })
      }
      return new Response("hello")
    },
    save: async ({ agentId, uploadName: name, source, bytes }) => {
      assert.equal(agentId, "vega")
      assert.equal(Buffer.isBuffer(source), false)
      assert.ok(source instanceof Readable)
      uploadName = name
      for await (const chunk of source) chunks.push(Buffer.from(chunk))
      assert.equal(bytes, 5)
      return { path: workstationUploadPath(name) }
    },
  })
  assert.equal(result.action, "saved")
  if (result.action !== "saved") return
  assert.equal(Buffer.concat(chunks).toString("utf8"), "hello")
  assert.equal(uploadName.includes(".."), false)
  assert.equal(uploadName.includes("/"), false)
  assert.match(uploadName, /-lab\.pdf$/)
  assert.equal(result.path, `/home/xiryn/uploads/${uploadName}`)
  assert.equal(result.fileParts.length, 0)
  assert.equal(
    result.userText,
    composeUserText("@Vega check the scan", {
      name: uploadName,
      mime: "application/pdf",
      bytes: 5,
      path: result.path,
    })
  )
  assert.ok(result.userText.startsWith("@Vega check the scan"))
  assert.match(result.userText, /The user sent a file: /)
  assert.equal(result.userText.includes(TOKEN), false)
})

test("an image is attached only when the selected model accepts images", async () => {
  async function receive(modelSpec: string | null) {
    return receiveInboundFile({
      isOwner: true,
      message: photoMessage({ caption: "look" }),
      token: TOKEN,
      agentId: "agent-1",
      modelSpec,
      apiBase: "http://telegram.test",
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.includes("/getFile")) {
          return jsonResponse({
            ok: true,
            result: { file_id: "large", file_size: 4, file_path: "photos/a.jpg" },
          })
        }
        return new Response("jpeg")
      },
      save: async ({ uploadName, source }) => {
        let seen = 0
        for await (const chunk of source) seen += chunk.length
        assert.ok(seen > 0)
        return { path: workstationUploadPath(uploadName) }
      },
    })
  }

  const vision = await receive("openai/gpt-6-luna")
  assert.equal(vision.action, "saved")
  if (vision.action !== "saved") return
  assert.equal(vision.fileParts.length, 1)
  assert.equal(vision.fileParts[0]?.type, "file")
  assert.equal(vision.fileParts[0]?.mediaType, "image/jpeg")
  assert.ok(vision.fileParts[0]?.url.startsWith("data:image/jpeg;base64,"))
  assert.equal(vision.userText.includes(TOKEN), false)

  const converted = await convertToModelMessages([
    {
      role: "user",
      parts: [{ type: "text", text: vision.userText }, ...vision.fileParts],
    },
  ])
  const content = converted[0]?.content
  assert.ok(Array.isArray(content))
  const file = content.find((part) => part.type === "file")
  assert.ok(file && file.type === "file")
  assert.equal(file.mediaType, "image/jpeg")
  const data = file.data as { type?: string; url?: URL } | URL | string
  const url =
    data instanceof URL
      ? data.href
      : typeof data === "string"
        ? data
        : data.url
          ? String(data.url)
          : ""
  assert.ok(url.startsWith("data:image/jpeg;base64,"))

  const local = await receive("ollama/llama3.2")
  assert.equal(local.action, "saved")
  if (local.action !== "saved") return
  assert.equal(local.fileParts.length, 0)
  assert.match(local.userText, /The user sent a file: /)
})

test("image input follows the model, not the file alone", () => {
  assert.equal(modelAcceptsImageInput("openai/gpt-6-luna"), true)
  assert.equal(modelAcceptsImageInput("anthropic/claude-sonnet-5-5"), true)
  assert.equal(modelAcceptsImageInput("google/gemini-2.5-pro"), true)
  assert.equal(modelAcceptsImageInput("xai/grok-4"), true)
  assert.equal(modelAcceptsImageInput("bedrock/eu.anthropic.claude-sonnet-5-5"), true)
  assert.equal(modelAcceptsImageInput("openai/whisper-1"), false)
  assert.equal(modelAcceptsImageInput("deepseek/deepseek-chat"), false)
  assert.equal(modelAcceptsImageInput("ollama/llama3.2"), false)
  assert.equal(modelAcceptsImageInput("ollama/llava:13b"), true)
  assert.equal(modelAcceptsImageInput(null), false)
  assert.equal(modelAcceptsImageInput("not-a-spec"), false)
})

test("a voice note tells the owner it needs speech to text and downloads nothing", async () => {
  let fetched = false
  const result = await receiveInboundFile({
    isOwner: true,
    message: { voice: { file_id: "v" } },
    token: TOKEN,
    agentId: "agent-1",
    modelSpec: "openai/gpt-6-luna",
    apiBase: "http://telegram.test",
    fetchImpl: async () => {
      fetched = true
      return jsonResponse({ ok: true, result: {} })
    },
  })
  assert.equal(result.action, "voice")
  assert.equal(fetched, false)
  if (result.action !== "voice") return
  assert.equal(result.message, VOICE_NOTE_REPLY)
  assert.match(result.message, /speech-to-text/i)
})
