// Shared by the worktree helper and the session service. Kept in its own
// module so neither has to import the other.
export function worktreeLocation(branchPrefix: string, taskId: string) {
  return {
    branch: `${branchPrefix}/${taskId}`,
    path: `/tmp/xiryn-wt-${taskId}`,
  }
}
