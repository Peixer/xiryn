import assert from "node:assert/strict"
import { test } from "node:test"

import {
  prepareRepoPath,
  REPO_PATH_ABSOLUTE,
  REPO_PATH_ESCAPE,
  REPO_PATH_MISSING,
  REPO_PATH_REJECTED,
  repoPathError,
} from "./repo-path"

const allowed = [
  "/home/xiryn/xiryn",
  "/home/xiryn/xiryn/",
  "/home/xiryn/src/app",
  "/home/xiryn/my repo",
]

const rejected = [
  "/etc/passwd",
  "/tmp/repo",
  "/tmp/xiryn-wt-abc",
  "/home/xiryn",
  "/home/xiryn/",
  "/home/xiryn/.coding-creds",
  "/home/xiryn/.git-credentials",
  "/home/xiryn/.ssh/id_ed25519",
  "/home/xiryn/xiryn/.git",
  "/home/xiryn/xiryn/../../etc",
  "/home/xiryn/xiryn/../../../tmp/repo",
  "/home/xiryn/../etc/passwd",
  "/home/xiryn/xiryn/./secret",
  "/home/xiryn//xiryn",
  "/home/xiryn/xiryn/%2e%2e/%2e%2e/etc/passwd",
  "/home/xiryn/xiryn/..\\..\\etc",
  "/home/xiryn/xiryn/\u0000",
  "/Home/xiryn/xiryn",
]

test("visible directories under the workstation home are allowed", () => {
  for (const repoPath of allowed) {
    assert.equal(repoPathError(repoPath), null, repoPath)
  }
})

test("repo paths outside the workspace, hidden, or traversing are rejected", () => {
  for (const repoPath of rejected) {
    assert.equal(repoPathError(repoPath), REPO_PATH_REJECTED, repoPath)
  }
  assert.equal(repoPathError("xiryn"), REPO_PATH_ABSOLUTE)
  assert.equal(repoPathError("~/xiryn"), REPO_PATH_ABSOLUTE)
  assert.equal(repoPathError(""), REPO_PATH_ABSOLUTE)
})

test("a symlink that stays inside the workspace is canonicalised", async () => {
  const prepared = await prepareRepoPath(
    "/home/xiryn/link",
    async () => "/home/xiryn/other/"
  )
  assert.deepEqual(prepared, { ok: true, path: "/home/xiryn/other" })
})

test("a symlink that escapes the workspace is rejected", async () => {
  for (const escaped of [
    "/etc/passwd",
    "/home/xiryn/.coding-creds",
    "/home/xiryn/.ssh",
    "/tmp/xiryn-wt-abc",
    "/home/xiryn",
  ]) {
    const prepared = await prepareRepoPath("/home/xiryn/link", async () => escaped)
    assert.deepEqual(prepared, { ok: false, error: REPO_PATH_ESCAPE }, escaped)
  }
})

test("a missing repository does not start a session", async () => {
  const prepared = await prepareRepoPath("/home/xiryn/missing", async () => {
    throw new Error(REPO_PATH_MISSING)
  })
  assert.deepEqual(prepared, { ok: false, error: REPO_PATH_MISSING })
})

test("lexical rejection happens before the workstation is asked", async () => {
  let called = false
  const prepared = await prepareRepoPath("/etc/passwd", async () => {
    called = true
    return "/etc/passwd"
  })
  assert.equal(prepared.ok, false)
  if (!prepared.ok) assert.equal(prepared.error, REPO_PATH_REJECTED)
  assert.equal(called, false)
})
