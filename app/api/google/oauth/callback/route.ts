import { NextResponse } from "next/server"

import { exchangeGoogleCode, verifyGoogleState } from "@/lib/mcp/google"

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;"
  )
}

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;line-height:1.5"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><p><a href="/settings">Back to settings</a></p></body>`
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

function settingsRedirect(requestUrl: string) {
  const configured = process.env.XIRYN_URL?.trim().replace(/\/+$/, "")
  if (configured) return NextResponse.redirect(`${configured}/settings`)
  return NextResponse.redirect(new URL("/settings", requestUrl))
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const error = url.searchParams.get("error")
  if (error)
    return page("Google was not connected", "Google sent you back without access.", 400)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state)
    return page("Google was not connected", "The callback was missing a code.", 400)
  try {
    verifyGoogleState(state)
    await exchangeGoogleCode(code)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The token exchange failed."
    return page("Google was not connected", message, 400)
  }
  return settingsRedirect(request.url)
}
