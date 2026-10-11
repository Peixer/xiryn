"use client"

import * as React from "react"

import type { VaultMarker } from "@/lib/vault-requests"

// Lets anything in a thread (an agent's hand-off card, a payment approval)
// start a take-over or answer the agent
export type TakeoverControl = {
  // False in squads and without a workstation: there is no desktop to take
  available: boolean
  active: boolean
  start: () => void
  // Continues the thread with a message from the person
  send: (text: string, vault?: VaultMarker) => void
}

export const TakeoverContext = React.createContext<TakeoverControl>({
  available: false,
  active: false,
  start: () => {},
  send: () => {},
})

export function useTakeover() {
  return React.useContext(TakeoverContext)
}
