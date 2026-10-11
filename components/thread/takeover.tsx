"use client"

import * as React from "react"

// Lets anything in a thread (e.g. an agent's hand-off card) start a take-over
export type TakeoverControl = {
  // False in squads and without a workstation: there is no desktop to take
  available: boolean
  active: boolean
  start: () => void
}

export const TakeoverContext = React.createContext<TakeoverControl>({
  available: false,
  active: false,
  start: () => {},
})

export function useTakeover() {
  return React.useContext(TakeoverContext)
}
