import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"

import { db } from "@/db"
import { agents } from "@/db/schema"
import {
  AttachmentError,
  describeUpload,
  isAgentId,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  parseMultipart,
  type Attachment,
} from "@/lib/attachments"
import { DockerMissingError, ensureEngine } from "@/lib/docker"
import { removeUploadsFile, writeUploadsFile } from "@/lib/workstation"

export const runtime = "nodejs"

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

function failure(error: unknown) {
  if (error instanceof AttachmentError) return fail(error.message)
  if (error instanceof DockerMissingError) {
    return fail("Docker isn't available, so there's nowhere to store the file.", 503)
  }
  const message = error instanceof Error ? error.message : "Couldn't store that file."
  console.error("[xiryn] upload:", message.slice(0, 300))
  return fail("Couldn't store that file.", 500)
}

// Stream each file into the agent's workstation uploads folder. The body is
// never buffered whole: multipart parts are written as they arrive.
export async function POST(request: Request) {
  const agentId = new URL(request.url).searchParams.get("agentId") ?? ""
  if (!isAgentId(agentId)) return fail("Missing agent.")
  const agent = db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()
  if (!agent) return fail("Agent not found.", 404)

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/form-data") || !request.body) {
    return fail("Upload is not multipart.")
  }

  // Fail before reading the body when the workstation can't be started.
  try {
    await ensureEngine()
  } catch (error) {
    return failure(error)
  }

  const started: string[] = []
  const files: Attachment[] = []
  const active: { abort: (() => Promise<void>) | null } = { abort: null }

  try {
    await parseMultipart(request.body, contentType, {
      maxFiles: MAX_FILES_PER_MESSAGE,
      maxBytes: MAX_FILE_BYTES,
      onField() {},
      onFile(file) {
        const described = describeUpload(
          file.filename || "file",
          file.mediaType,
          nanoid(10)
        )
        const stream = new TransformStream<Uint8Array, Uint8Array>()
        const writer = stream.writable.getWriter()
        let size = 0
        let failed: unknown = null
        started.push(described.path)
        // Handle the rejection immediately so a missing workstation can't
        // leave the upload stream waiting on a reader that never starts.
        const done = writeUploadsFile(agentId, described.path, stream.readable).catch(
          (error: unknown) => {
            failed = error
            return writer.abort(error).catch(() => {})
          }
        )
        active.abort = async () => {
          await writer.abort().catch(() => {})
          await done
        }
        return {
          async write(chunk) {
            if (failed) throw failed
            size += chunk.byteLength
            await writer.write(chunk)
          },
          async close() {
            if (failed) throw failed
            await Promise.all([writer.close().catch(() => {}), done])
            if (failed) throw failed
            active.abort = null
            files.push({ ...described, size, agentId })
          },
        }
      },
    })
  } catch (error) {
    await active.abort?.()
    await Promise.all(
      started.map((path) => removeUploadsFile(agentId, path).catch(() => {}))
    )
    return failure(error)
  }

  if (files.length === 0) return fail("Choose a file to attach.")
  return Response.json({ files })
}
