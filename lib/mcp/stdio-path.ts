import fs from "node:fs"

import { commandBasename, isShellBasename } from "@/lib/mcp/stdio-policy"

// Inode identity of a shell, so a hard link named npx is still a shell.
const SHELL_CANDIDATES = [
  "/bin/sh",
  "/bin/bash",
  "/bin/dash",
  "/bin/zsh",
  "/bin/ash",
  "/bin/busybox",
  "/usr/bin/sh",
  "/usr/bin/bash",
  "/usr/bin/dash",
  "/usr/bin/zsh",
  "/usr/bin/fish",
  "/usr/bin/busybox",
  "/usr/bin/rbash",
]

function clip(value: string) {
  const clean = value.replace(/[\n\r\u0000]/g, " ")
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean
}

function shellIdentity(stat: fs.Stats) {
  for (const candidate of SHELL_CANDIDATES) {
    let shellStat: fs.Stats
    try {
      shellStat = fs.statSync(/*turbopackIgnore: true*/ candidate)
    } catch {
      continue
    }
    if (shellStat.dev === stat.dev && shellStat.ino === stat.ino) {
      return commandBasename(candidate).toLowerCase()
    }
  }
  return null
}

// A trusted directory can still hold a symlink or hard link to bash.
// Missing files are allowed here; spawn fails until the program exists.
export function stdioPathRefusal(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed.includes("/") && !trimmed.includes("\\")) return null

  let stat: fs.Stats
  let real: string
  try {
    stat = fs.statSync(/*turbopackIgnore: true*/ trimmed)
    real = fs.realpathSync(/*turbopackIgnore: true*/ trimmed)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return null
    return `Refused command "${clip(trimmed)}". The path could not be resolved.`
  }

  const claimed = commandBasename(trimmed).toLowerCase()
  // /bin/sh is often a symlink to dash. That is still the shell the operator named.
  if (isShellBasename(claimed)) return null
  const resolved = commandBasename(real).toLowerCase()
  const shell = (isShellBasename(resolved) ? resolved : shellIdentity(stat)) ?? null
  if (!shell) return null
  return `Refused command "${clip(trimmed)}". The path resolves to the shell "${shell}".`
}
