// A coding session runs git and a coding CLI inside the agent's workstation,
// with that CLI's own permission prompts bypassed. The repository path is
// chosen by the model, so it has to stay inside the workstation home and
// away from the credential volume.

import path from "node:path"

export const WORKSTATION_HOME = "/home/xiryn"

export const REPO_PATH_ABSOLUTE = "Repository path must be absolute."
export const REPO_PATH_REJECTED =
  "Repository path must be a visible directory inside the workstation home (/home/xiryn), not the home itself, a hidden path, or a path outside it."
export const REPO_PATH_ESCAPE =
  "Repository path resolves outside the workstation workspace."
export const REPO_PATH_MISSING = "Repository path is not a directory in the workstation."

const HOME_SEGMENTS = WORKSTATION_HOME.split("/").filter(Boolean)

function stripTrailingSlash(value: string) {
  return value.length > 1 ? value.replace(/\/+$/, "") : value
}

// Lexical check only. It does not follow symlinks; callers that can see the
// workstation filesystem pass the realpath result through this again.
export function repoPathError(input: string): string | null {
  if (typeof input !== "string") return REPO_PATH_REJECTED
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return REPO_PATH_ABSOLUTE
  if (trimmed.length > 512) return REPO_PATH_REJECTED
  if (/[\u0000-\u001f\u007f\\%]/.test(trimmed)) return REPO_PATH_REJECTED
  const parts = stripTrailingSlash(trimmed).split("/")
  if (parts[0] !== "") return REPO_PATH_REJECTED
  const segments = parts.slice(1)
  if (
    segments.length === 0 ||
    segments.some((part) => part === "" || part === "." || part === "..")
  ) {
    return REPO_PATH_REJECTED
  }
  if (
    segments.length < HOME_SEGMENTS.length + 1 ||
    HOME_SEGMENTS.some((part, index) => segments[index] !== part)
  ) {
    return REPO_PATH_REJECTED
  }
  // A leading dot is the credential volume (.coding-creds), the git
  // credential symlink, .ssh, or a .git directory.
  if (segments.some((part) => part.startsWith("."))) return REPO_PATH_REJECTED
  return null
}

export function canonicalRepoPath(input: string) {
  if (repoPathError(input)) return null
  const canonical = path.posix.normalize(stripTrailingSlash(input.trim()))
  return repoPathError(canonical) ? null : canonical
}

export async function prepareRepoPath(
  input: string,
  resolve: (repoPath: string) => Promise<string>
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const lexical = repoPathError(input)
  if (lexical) return { ok: false, error: lexical }
  const requested = canonicalRepoPath(input)
  if (!requested) return { ok: false, error: REPO_PATH_REJECTED }
  let resolved: string
  try {
    resolved = (await resolve(requested)).trim()
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : REPO_PATH_MISSING
    return { ok: false, error: message.split("\n")[0].slice(0, 300) }
  }
  if (!resolved || repoPathError(resolved)) {
    return { ok: false, error: REPO_PATH_ESCAPE }
  }
  const canonical = canonicalRepoPath(resolved)
  if (!canonical) return { ok: false, error: REPO_PATH_ESCAPE }
  return { ok: true, path: canonical }
}
