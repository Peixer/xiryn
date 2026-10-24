import assert from "node:assert/strict"
import { test } from "node:test"

import { validatePinnedSha } from "./sha"

const TIP = "abc123abc123abc123abc123abc123abc123abcd"

test("only the exact tip of the configured branch is accepted", () => {
  const ok = validatePinnedSha({
    sha: TIP,
    branch: "main",
    configuredBranch: "main",
    tip: TIP,
  })
  assert.deepEqual(ok, { ok: true, sha: TIP })

  assert.equal(
    validatePinnedSha({ sha: "main", branch: "main", configuredBranch: "main", tip: TIP })
      .ok,
    false
  )
  assert.equal(
    validatePinnedSha({
      sha: TIP.slice(0, 12),
      branch: "main",
      configuredBranch: "main",
      tip: TIP,
    }).ok,
    false
  )
  assert.equal(
    validatePinnedSha({
      sha: TIP.toUpperCase(),
      branch: "main",
      configuredBranch: "main",
      tip: TIP,
    }).ok,
    false
  )
  assert.equal(
    validatePinnedSha({
      sha: "b".repeat(40),
      branch: "main",
      configuredBranch: "main",
      tip: TIP,
    }).ok,
    false
  )
  assert.equal(
    validatePinnedSha({
      sha: TIP,
      branch: "refs/heads/main",
      configuredBranch: "main",
      tip: TIP,
    }).ok,
    false
  )
  assert.equal(
    validatePinnedSha({
      sha: TIP,
      branch: "feature",
      configuredBranch: "main",
      tip: TIP,
    }).ok,
    false
  )
  assert.equal(
    validatePinnedSha({
      sha: TIP,
      branch: "main",
      configuredBranch: "refs/heads/../main",
      tip: TIP,
    }).ok,
    false
  )
})
