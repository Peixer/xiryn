import type { AgentCategory } from "./agent-categories"

export {
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type AgentCategory,
} from "./agent-categories"

// Legacy volume. Coding agents with no credential of their own mount it
// read-only, so an upgrade does not take git away from a workstation that
// already pushes with this file (the live host's gr8-codegen agent).
export const SHARED_GIT_VOLUME = "xiryn-coding-creds"

// Same path for the shared volume and a per-agent volume, so a home-folder
// symlink of ~/.git-credentials keeps resolving after the mount changes.
export const GIT_CREDS_MOUNT = "/home/xiryn/.coding-creds"

// Nanoid ids, plus the short ids tests use. Rejects path separators so the
// value can be a Docker volume name and a container-name suffix.
export function isGitCredentialAgentId(id: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

export function gitCredentialVolume(agentId: string) {
  if (!isGitCredentialAgentId(agentId)) {
    throw new Error("Agent id cannot be used as a git credential volume name.")
  }
  return `xiryn-git-creds-${agentId}`
}

export type CodingCredentialMode = "own" | "shared" | "off"

// No agent is chosen by age. An agent with its own volume sees only that
// volume. Everyone else in the coding category still sees the shared
// fallback, read-only, until the owner assigns one.
export function codingCredentialMode(
  agent: { id: string; category: AgentCategory | string },
  hasOwnCredential: boolean
): CodingCredentialMode {
  if (agent.category !== "coding") return "off"
  if (hasOwnCredential && isGitCredentialAgentId(agent.id)) return "own"
  return "shared"
}

export function codingAccess(
  agent: { id: string; category: AgentCategory | string },
  hasOwnCredential: boolean
): CodingCredentialMode {
  return codingCredentialMode(agent, hasOwnCredential)
}

export function codingVolumeArgs(
  agent: { id: string; category: AgentCategory | string },
  hasOwnCredential: boolean
): string[] {
  const mode = codingCredentialMode(agent, hasOwnCredential)
  if (mode === "off") return []
  const volume = mode === "own" ? gitCredentialVolume(agent.id) : SHARED_GIT_VOLUME
  const access = mode === "own" ? "rw" : "ro"
  return [
    "--volume",
    `${volume}:${GIT_CREDS_MOUNT}:${access}`,
    "--env",
    "XIRYN_CODING_TOOLS=1",
    "--env",
    `XIRYN_GIT_CREDS_MODE=${mode}`,
  ]
}
