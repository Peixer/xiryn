import { removeSubscription, saveSubscription } from "@/lib/web-push"

export const dynamic = "force-dynamic"

function endpointOf(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") return null
    return value
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    subscription?: unknown
  } | null
  const saved = await saveSubscription(body?.subscription)
  if (!saved) {
    return Response.json(
      { error: "That push subscription isn't valid." },
      { status: 400 }
    )
  }
  return new Response(null, { status: 204 })
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null
  const endpoint = endpointOf(body?.endpoint)
  if (!endpoint) return Response.json({ error: "Missing subscription." }, { status: 400 })
  await removeSubscription(endpoint)
  return new Response(null, { status: 204 })
}
