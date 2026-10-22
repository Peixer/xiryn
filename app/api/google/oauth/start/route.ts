import { NextResponse } from "next/server"

import { googleAuthUrl } from "@/lib/mcp/google"

// Sends the browser to Google. The redirect comes back to this same host,
// which is what makes consent work on a headless server.
export function GET() {
  try {
    return NextResponse.redirect(googleAuthUrl())
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start Google sign-in."
    return new NextResponse(message, { status: 400 })
  }
}
