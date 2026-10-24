// Blue/green cutover states. The running process never restarts itself:
// building happens on the other colour, and switching only flips the proxy.

export const PHASES = [
  "idle",
  "building",
  "ready",
  "switching",
  "active",
  "rolled_back",
] as const

export type Phase = (typeof PHASES)[number]
export type Colour = "blue" | "green"
export type Baseline = "idle" | "active" | "rolled_back"

export type DeployState = {
  phase: Phase
  active: Colour
  activeSha: string | null
  previous: Colour | null
  previousSha: string | null
  candidate: Colour | null
  candidateSha: string | null
  branch: string
  error: string | null
  maintenance: boolean
  baseline: Baseline
  operation: "switch" | "rollback" | null
}

export type DeployEvent =
  | { type: "prepare"; sha: string }
  | { type: "build_ok" }
  | { type: "build_fail"; error: string }
  | { type: "switch_begin" }
  | { type: "switch_abort"; error: string }
  | { type: "switch_ok" }
  | { type: "switch_fail"; error: string }
  | { type: "rollback_begin" }
  | { type: "rollback_ok" }
  | { type: "rollback_fail"; error: string }

const SHA = /^[0-9a-f]{40}$/

export function otherColour(colour: Colour): Colour {
  return colour === "blue" ? "green" : "blue"
}

export function initialState(over: Partial<DeployState> = {}): DeployState {
  return {
    phase: "idle",
    active: "blue",
    activeSha: null,
    previous: null,
    previousSha: null,
    candidate: null,
    candidateSha: null,
    branch: "main",
    error: null,
    maintenance: false,
    baseline: "idle",
    operation: null,
    ...over,
  }
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TransitionError"
  }
}

function illegal(state: DeployState, event: DeployEvent): never {
  throw new TransitionError(`Illegal ${event.type} from ${state.phase}.`)
}

function requireSha(sha: string) {
  if (!SHA.test(sha))
    throw new TransitionError("A target commit must be 40 lowercase hex characters.")
}

export function transition(state: DeployState, event: DeployEvent): DeployState {
  switch (event.type) {
    case "prepare": {
      if (
        state.phase !== "idle" &&
        state.phase !== "active" &&
        state.phase !== "rolled_back" &&
        state.phase !== "ready"
      ) {
        illegal(state, event)
      }
      requireSha(event.sha)
      const baseline: Baseline = state.phase === "ready" ? state.baseline : state.phase
      return {
        ...state,
        phase: "building",
        baseline,
        candidate: otherColour(state.active),
        candidateSha: event.sha,
        error: null,
        maintenance: false,
        operation: null,
      }
    }
    case "build_ok": {
      if (state.phase !== "building" || !state.candidate || !state.candidateSha) {
        illegal(state, event)
      }
      return { ...state, phase: "ready", error: null, maintenance: false }
    }
    case "build_fail": {
      if (state.phase !== "building") illegal(state, event)
      return {
        ...state,
        phase: state.baseline,
        candidate: null,
        candidateSha: null,
        error: event.error,
        maintenance: false,
        operation: null,
      }
    }
    case "switch_begin": {
      const ready = state.phase === "ready" || state.phase === "rolled_back"
      if (!ready || !state.candidate || !state.candidateSha) illegal(state, event)
      return {
        ...state,
        phase: "switching",
        operation: "switch",
        maintenance: true,
        error: null,
      }
    }
    case "switch_abort": {
      if (state.phase !== "switching" || state.operation !== "switch")
        illegal(state, event)
      return {
        ...state,
        phase: "ready",
        operation: null,
        maintenance: false,
        error: event.error,
      }
    }
    case "switch_ok": {
      if (state.phase !== "switching" || state.operation !== "switch")
        illegal(state, event)
      if (!state.candidate || !state.candidateSha) illegal(state, event)
      return {
        ...state,
        phase: "active",
        baseline: "active",
        previous: state.active,
        previousSha: state.activeSha,
        active: state.candidate,
        activeSha: state.candidateSha,
        candidate: null,
        candidateSha: null,
        operation: null,
        maintenance: false,
        error: null,
      }
    }
    case "switch_fail": {
      if (state.phase !== "switching" || state.operation !== "switch")
        illegal(state, event)
      return {
        ...state,
        phase: "rolled_back",
        baseline: "rolled_back",
        operation: null,
        maintenance: false,
        error: event.error,
      }
    }
    case "rollback_begin": {
      if (state.phase !== "active" || !state.previous || !state.previousSha) {
        illegal(state, event)
      }
      return {
        ...state,
        phase: "switching",
        operation: "rollback",
        maintenance: true,
        error: null,
      }
    }
    case "rollback_ok": {
      if (state.phase !== "switching" || state.operation !== "rollback")
        illegal(state, event)
      if (!state.previous || !state.previousSha) illegal(state, event)
      return {
        ...state,
        phase: "rolled_back",
        baseline: "rolled_back",
        candidate: state.active,
        candidateSha: state.activeSha,
        active: state.previous,
        activeSha: state.previousSha,
        previous: null,
        previousSha: null,
        operation: null,
        maintenance: false,
        error: null,
      }
    }
    case "rollback_fail": {
      if (state.phase !== "switching" || state.operation !== "rollback")
        illegal(state, event)
      return {
        ...state,
        phase: "active",
        baseline: "active",
        operation: null,
        maintenance: false,
        error: event.error,
      }
    }
    default:
      illegal(state, event)
  }
}
