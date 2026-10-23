"use server"

import { pushKeys } from "@/lib/web-push"

// The public key is public. The private key is not returned.
export async function pushClientConfig() {
  return { publicKey: pushKeys()?.publicKey ?? null }
}
