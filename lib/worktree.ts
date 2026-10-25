import { execFileSync } from "node:child_process"
import path from "node:path"
import { nanoid } from "nanoid"

export type GitRunner = (args: string[]) => Promise<string>
export type WorktreeHandle = {
  id: string
  path: string
  branch: string
  baseBranch: string
  repoPath: string
  cleanup: (options?: { preserveBranch?: boolean }) => Promise<void>
}
export type WorktreeOptions = {
  repoPath: string
  baseBranch?: string
  branchPrefix?: string
  taskId?: string
  // Agent callers supply a workstation runner; the default is for local utilities.
  runGit?: GitRunner
}
const localGit: GitRunner = async (args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 30_000, stdio: "pipe" })

export async function createWorktree(opts: WorktreeOptions): Promise<WorktreeHandle> {
  const {
    repoPath,
    baseBranch = "main",
    branchPrefix = "task",
    taskId = nanoid(8),
    runGit = localGit,
  } = opts
  if (!path.isAbsolute(repoPath)) throw new Error("Repository path must be absolute")
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error("Invalid task id")
  const branch = `${branchPrefix}/${taskId}`
  const wtPath = path.posix.join("/tmp", `xiryn-wt-${taskId}`)
  const git = (args: string[]) => runGit(["-C", repoPath, ...args])
  await git(["check-ref-format", "--branch", branch])
  let base = baseBranch
  try {
    await git(["rev-parse", "--verify", `refs/remotes/origin/${baseBranch}^{commit}`])
    base = `refs/remotes/origin/${baseBranch}`
  } catch {
    await git(["rev-parse", "--verify", `refs/heads/${baseBranch}^{commit}`])
    base = `refs/heads/${baseBranch}`
  }
  // Never remove an existing directory: it may belong to another session.
  await git(["worktree", "add", "-b", branch, wtPath, base])
  const cleanup: WorktreeHandle["cleanup"] = async ({ preserveBranch = false } = {}) => {
    await git(["worktree", "remove", "--force", wtPath])
    if (!preserveBranch) await git(["branch", "-D", branch])
  }
  return { id: taskId, path: wtPath, branch, baseBranch, repoPath, cleanup }
}

export function listWorktrees(
  repoPath: string
): Array<{ path: string; branch: string; isMain: boolean }> {
  try {
    const output = execFileSync(
      "git",
      ["-C", repoPath, "worktree", "list", "--porcelain"],
      { encoding: "utf8", timeout: 10_000 }
    )
    return output
      .trim()
      .split(/\n\n/)
      .map((entry, index) => ({
        path:
          entry
            .split("\n")
            .find((line) => line.startsWith("worktree "))
            ?.slice(9) ?? "",
        branch:
          entry
            .split("\n")
            .find((line) => line.startsWith("branch "))
            ?.slice(7)
            .replace("refs/heads/", "") ?? "",
        isMain: index === 0,
      }))
  } catch {
    return []
  }
}
export function pruneWorktrees(repoPath: string): void {
  try {
    execFileSync("git", ["-C", repoPath, "worktree", "prune"], {
      stdio: "pipe",
      timeout: 10_000,
    })
  } catch {
    /* Non-fatal. */
  }
}
