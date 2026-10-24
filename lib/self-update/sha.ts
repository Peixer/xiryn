// A self-update may only build the exact tip of the configured branch.
// Short names, tags, other branches, and anything that is not 40 hex digits
// are refused before a request is written.

const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/

export function isSha(value: string) {
  return SHA.test(value)
}

export function isBranchName(value: string) {
  return BRANCH.test(value) && !value.includes("..") && !value.endsWith("/")
}

export function validatePinnedSha(input: {
  sha: string
  branch: string
  configuredBranch: string
  tip: string
}): { ok: true; sha: string } | { ok: false; reason: string } {
  if (!isBranchName(input.configuredBranch)) {
    return { ok: false, reason: "The configured branch is not a single safe name." }
  }
  if (input.branch !== input.configuredBranch) {
    return { ok: false, reason: "Refusing a branch other than the configured one." }
  }
  if (!isSha(input.sha)) {
    return { ok: false, reason: "The target must be a 40-character lowercase commit." }
  }
  if (!isSha(input.tip)) {
    return { ok: false, reason: "The branch tip is not a commit." }
  }
  if (input.sha !== input.tip) {
    return { ok: false, reason: "The target is not the tip of the configured branch." }
  }
  return { ok: true, sha: input.sha }
}
