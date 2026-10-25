// What a finished coding session is willing to commit. `git add -A` already
// skips ignored files; this also refuses untracked build output and anything
// too large to belong in the branch.

export const MAX_STAGE_BYTES = 1_000_000

const BUILD_ARTIFACT =
  /(?:^|\/)(?:node_modules|dist|build|\.next|out|coverage|\.turbo|__pycache__)(?:\/|$)|(?:^|\/)[^/]+\.(?:pyc|pyo|class|o|obj|a|so|dylib|dll|exe|jar|tsbuildinfo)$/i

export function isUntrackedBuildArtifact(filePath: string) {
  return BUILD_ARTIFACT.test(filePath.replaceAll("\\", "/"))
}

export function parsePorcelain(text: string): { path: string; untracked: boolean }[] {
  return text
    .split("\n")
    .filter((line) => line.length >= 4)
    .map((line) => {
      const untracked = line.startsWith("??")
      let filePath = line.slice(3)
      const renamed = filePath.split(" -> ")
      if (renamed.length === 2) filePath = renamed[1]
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        try {
          filePath = JSON.parse(filePath) as string
        } catch {
          /* Keep the raw path. */
        }
      }
      return { path: filePath, untracked }
    })
}

export type SkippedPath = { path: string; reason: string }

export async function commitWorktreeChanges(opts: {
  cwd: string
  runGit: (args: string[]) => Promise<string>
  onSkip?: (filePath: string, reason: string) => void
  message?: string
  maxBytes?: number
}): Promise<{ committed: boolean; skipped: SkippedPath[] }> {
  const git = (args: string[]) => opts.runGit(["-C", opts.cwd, ...args])
  const skipped: SkippedPath[] = []
  const skip = (filePath: string, reason: string) => {
    skipped.push({ path: filePath, reason })
    opts.onSkip?.(filePath, reason)
    console.info(`[xiryn] work session skipped ${filePath}: ${reason}`)
  }
  const changes = parsePorcelain(await git(["status", "--porcelain", "-uall"]))
  if (changes.length === 0) return { committed: false, skipped }

  const artifacts = changes.filter(
    (file) => file.untracked && isUntrackedBuildArtifact(file.path)
  )
  // Nothing but generated files: leave them untracked and do not commit.
  if (artifacts.length === changes.length) {
    for (const file of artifacts) skip(file.path, "untracked build artifact")
    return { committed: false, skipped }
  }

  await git(["add", "-A"])
  for (const file of artifacts) {
    await unstage(git, file.path)
    skip(file.path, "untracked build artifact")
  }

  const limit = opts.maxBytes ?? MAX_STAGE_BYTES
  const staged = (await git(["diff", "--cached", "--name-only", "-z"]))
    .split("\0")
    .filter(Boolean)
  for (const filePath of staged) {
    const size = Number((await git(["cat-file", "-s", `:${filePath}`])).trim())
    if (Number.isFinite(size) && size > limit) {
      await unstage(git, filePath)
      skip(filePath, `file is ${size} bytes, over the ${limit} byte stage limit`)
    }
  }

  const remaining = (await git(["diff", "--cached", "--name-only"])).trim()
  if (!remaining) return { committed: false, skipped }

  await git([
    "-c",
    "user.name=Xiryn",
    "-c",
    "user.email=xiryn@localhost",
    "commit",
    "-m",
    opts.message ?? "feat: complete work session",
  ])
  return { committed: true, skipped }
}

async function unstage(git: (args: string[]) => Promise<string>, filePath: string) {
  try {
    await git(["reset", "-q", "HEAD", "--", filePath])
  } catch {
    await git(["rm", "--cached", "-q", "--", filePath])
  }
}
