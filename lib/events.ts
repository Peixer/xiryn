// Things worth telling the person about, wherever they are in the app. The
// browser follows them over /api/events and turns them into a sound, a
// desktop notification and a toast.

export type OrynEvent =
  | {
      type: "turn-finished"
      threadId: string
      href: string
      // Who answered (the last agent to hold the turn)
      name: string
      preview: string
      ok: boolean
      error?: string
      durationMs: number
    }
  | {
      type: "takeover"
      threadId: string
      href: string
      name: string
      reason: string
    }

type Listener = (event: OrynEvent) => void

const globalForEvents = globalThis as unknown as { __orynEvents?: Set<Listener> }
const listeners = (globalForEvents.__orynEvents ??= new Set())

export function emit(event: OrynEvent) {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[oryn] event listener failed:", error)
    }
  }
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
