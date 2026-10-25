import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createWorktree, listWorktrees, pruneWorktrees } from "./worktree"
function hasGit() {
  try {
    execFileSync("git", ["--version"])
    return fs.existsSync(path.join(os.homedir(), "xiryn/.git"))
  } catch {
    return false
  }
}
const repoPath = path.join(os.homedir(), "xiryn")
test(
  "creates a worktree and branch, then removes both",
  { skip: !hasGit() },
  async () => {
    const wt = await createWorktree({ repoPath })
    try {
      assert.ok(fs.existsSync(wt.path))
      assert.ok(listWorktrees(repoPath).some((item) => item.branch === wt.branch))
    } finally {
      await wt.cleanup()
    }
    assert.equal(fs.existsSync(wt.path), false)
    assert.equal(
      listWorktrees(repoPath).some((item) => item.branch === wt.branch),
      false
    )
    assert.throws(() =>
      execFileSync(
        "git",
        ["-C", repoPath, "show-ref", "--verify", `refs/heads/${wt.branch}`],
        { stdio: "pipe" }
      )
    )
  }
)
test("lists main worktree", { skip: !hasGit() }, () =>
  assert.ok(listWorktrees(repoPath)[0].isMain)
)
test("prune does not throw", { skip: !hasGit() }, () =>
  assert.doesNotThrow(() => pruneWorktrees(repoPath))
)

test(
  "worktree streams output into its tracked session",
  { skip: !hasGit() },
  async () => {
    const { upsertSession, getSession, workSessions } = await import("./work-sessions")
    const id = `test-${Date.now()}`
    upsertSession({
      id,
      agentId: "test",
      agentName: "Test",
      task: "test",
      tool: "codex",
      branch: "",
      repoPath,
      status: "running",
      startedAt: new Date(),
      output: [],
    })
    const wt = await createWorktree({ repoPath, sessionId: id })
    try {
      wt.onOutput("hello")
      assert.equal(getSession(id)?.branch, wt.branch)
      assert.equal(getSession(id)?.output.join(""), "hello\n")
      await wt.cleanup({ preserveBranch: true })
      assert.equal(fs.existsSync(wt.path), false)
      execFileSync(
        "git",
        ["-C", repoPath, "show-ref", "--verify", `refs/heads/${wt.branch}`],
        { stdio: "pipe" }
      )
    } finally {
      try {
        execFileSync("git", ["-C", repoPath, "worktree", "remove", "--force", wt.path], {
          stdio: "pipe",
        })
      } catch {
        /* Already removed. */
      }
      execFileSync("git", ["-C", repoPath, "branch", "-D", wt.branch], { stdio: "pipe" })
      workSessions.delete(id)
    }
  }
)
