import fs from "node:fs"
import path from "node:path"

import type { Layout } from "@/lib/self-update/layout"

// systemd bind-mounts every ReadWritePaths entry into the helper's mount
// namespace. rmdir or rename of that path returns EBUSY, after a recursive
// delete has already removed the children. The directory has to stay.

export function mountRoots(layout: Layout) {
  const deploy = layout.deployDir
  const roots = [
    layout.blueDir,
    layout.greenDir,
    layout.blueData,
    layout.greenData,
    path.dirname(layout.blueData),
    path.dirname(layout.greenData),
    layout.mirror,
    layout.backupDir,
    deploy,
    path.join(deploy, "npm-cache"),
    path.join(deploy, "cache"),
    path.join(deploy, "config"),
    path.join(deploy, "staging"),
    path.dirname(layout.caddyfile),
    path.dirname(layout.caddySnippet),
    path.dirname(layout.sharedEnv),
    path.dirname(layout.maintenanceFile),
  ]
  return [...new Set(roots.map((root) => path.resolve(root)))]
}

export function isMountRoot(layout: Layout, target: string) {
  return mountRoots(layout).includes(path.resolve(target))
}

function codeOf(error: unknown) {
  return (error as NodeJS.ErrnoException).code
}

export function clearChildren(dir: string) {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    const code = codeOf(error)
    if (code === "ENOENT" || code === "ENOTDIR") return
    throw error
  }
  for (const name of names) removeChild(path.join(dir, name))
}

function removeChild(target: string) {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(target)
  } catch (error) {
    if (codeOf(error) === "ENOENT") return
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fs.rmSync(target, { force: true })
    return
  }
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (error) {
    const code = codeOf(error)
    if (code !== "EBUSY" && code !== "ENOTEMPTY") throw error
    clearChildren(target)
  }
}

// Deletes a tree. A ReadWritePaths directory, or any directory whose rmdir
// returns EBUSY, is emptied and kept.
export function removeTree(layout: Layout, target: string) {
  if (!fs.existsSync(target)) return
  const stat = fs.lstatSync(target)
  if (!stat.isSymbolicLink() && stat.isDirectory() && isMountRoot(layout, target)) {
    clearChildren(target)
    return
  }
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (error) {
    const code = codeOf(error)
    if (code !== "EBUSY" && code !== "ENOTEMPTY") throw error
    if (stat.isDirectory() && !stat.isSymbolicLink()) clearChildren(target)
  }
}

// The inactive colour checkout. git clone needs an empty directory. The
// directory itself is a mount point, so it is never removed.
export function resetDirectory(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
  clearChildren(dir)
}

export function relocateTree(layout: Layout, from: string, to: string) {
  const blocked = isMountRoot(layout, from) || isMountRoot(layout, to)
  if (!blocked) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      const code = codeOf(error)
      if (code !== "EXDEV" && code !== "EBUSY") throw error
    }
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
  removeTree(layout, from)
}
