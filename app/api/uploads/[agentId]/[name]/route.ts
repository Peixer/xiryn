import { eq } from "drizzle-orm"

import { db } from "@/db"
import { agents } from "@/db/schema"
import {
  isAgentId,
  isImageMedia,
  mediaTypeFor,
  uploadPathForName,
} from "@/lib/attachments"
import { DockerMissingError } from "@/lib/docker"
import { readUploadsFile } from "@/lib/workstation"

export const runtime = "nodejs"

// Read-only. The name has to be one file inside that agent's uploads folder;
// symlinks and anything outside it are refused by readUploadsFile.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string; name: string }> }
) {
  const { agentId, name } = await ctx.params
  if (!isAgentId(agentId)) return new Response("Not found.", { status: 404 })
  // The framework usually decodes the segment once. Decode again only when
  // that still leaves an encoded name, and ignore a bare "%" (as in "100%").
  let stored = name
  if (name.includes("%")) {
    try {
      const decoded = decodeURIComponent(name)
      if (uploadPathForName(decoded)) stored = decoded
    } catch {
      stored = name
    }
  }
  const path = uploadPathForName(stored)
  if (!path) return new Response("Not found.", { status: 404 })

  const agent = db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()
  if (!agent) return new Response("Not found.", { status: 404 })

  try {
    const bytes = await readUploadsFile(agentId, path)
    if (!bytes) return new Response("Not found.", { status: 404 })
    const mediaType = mediaTypeFor(stored)
    const image = isImageMedia(mediaType)
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": image ? mediaType : "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": contentDisposition(stored, image),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    if (error instanceof DockerMissingError) {
      return new Response("Docker isn't available.", { status: 503 })
    }
    const message = error instanceof Error ? error.message : "Couldn't read the upload."
    console.error("[xiryn] upload read:", message.slice(0, 300))
    return new Response("Couldn't read the upload.", { status: 500 })
  }
}

function contentDisposition(name: string, inline: boolean) {
  const fallback = name.replace(/[^\w.\- ]+/g, "_").replaceAll('"', "") || "file"
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
