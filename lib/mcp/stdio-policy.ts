// What may be saved and spawned as an MCP stdio server. The check is pure so
// the settings screen, the save action, and the spawn path share one rule.

export const DEFAULT_MCP_LAUNCHERS = [
  "npx",
  "uvx",
  "node",
  "python3",
  "python",
  "docker",
  "bunx",
] as const

const LAUNCHER_LIST = DEFAULT_MCP_LAUNCHERS.join(", ")

const SHELLS = new Set([
  "sh",
  "bash",
  "rbash",
  "zsh",
  "dash",
  "ash",
  "fish",
  "ksh",
  "mksh",
  "csh",
  "tcsh",
  "pwsh",
  "powershell",
  "cmd",
  "busybox",
])

// Metacharacters that matter once a shell parses an argument. Backslash is
// included for arguments (escapes) and excluded for the command path so a
// Windows path such as C:\Program Files\nodejs\npx.cmd can still match.
const ARG_SHELL_META = /[;&|`$<>(){}[\]!#*?~\\\n\r'"\u0000]/
const COMMAND_META = /[;&|`$<>(){}[\]!#*?~'"\n\r\u0000]/
const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,64}$/

// Absolute paths are accepted only in install locations a loopback caller
// cannot write. Anywhere else, a file named npx can be a shell.
const TRUSTED_COMMAND_DIRS = [
  "/bin/",
  "/usr/bin/",
  "/usr/local/bin/",
  "/usr/local/opt/",
  "/opt/bin/",
  "/opt/homebrew/bin/",
  "/opt/homebrew/opt/",
  "/opt/local/bin/",
  "/home/linuxbrew/.linuxbrew/bin/",
  "/home/linuxbrew/.linuxbrew/opt/",
  "/nix/store/",
]

// Keys that choose the binary, inject code into an interpreter, or redirect
// the package index. Compared case-insensitively. Values are never echoed.
const BLOCKED_ENV_EXACT = new Set([
  "path",
  "pathext",
  "home",
  "ifs",
  "env",
  "bash_env",
  "shellopts",
  "zdotdir",
  "prompt_command",
  "comspec",
  "shell",
  "node_options",
  "node_path",
  "node_repl_external_module",
  "pythonpath",
  "pythonhome",
  "pythonstartup",
  "pythoninspect",
  "pythonuserbase",
  "pythonexecutable",
  "perl5opt",
  "perl5lib",
  "rubyopt",
  "rubylib",
  "gconv_path",
  "docker_host",
  "docker_context",
  "docker_config",
  "docker_cert_path",
  "git_ssh_command",
  "git_exec_path",
  "git_external_diff",
  "uv_extra_index_url",
  "uv_default_index",
  "uv_find_links",
  "uv_insecure_host",
  "pip_extra_index_url",
  "bun_install",
  "bun_config_registry",
])

export type StdioLaunch = {
  id: string
  command: string
  args: string[]
}

export type McpServerShape = {
  id: string
  transport: string
  command?: string
  args?: string[]
  enabled?: boolean
  env?: Record<string, string>
}

function clip(value: string) {
  const clean = value.replace(/[\n\r\u0000]/g, " ")
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean
}

export function extensionNames(
  value: string | undefined
): { ok: true; names: string[] } | { ok: false; error: string } {
  if (!value?.trim()) return { ok: true, names: [] }
  const names = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  for (const name of names) {
    if (!PROGRAM_NAME.test(name)) {
      return {
        ok: false,
        error: `mcp.allowedCommands must be a comma-separated list of program names, for example "my-mcp". "${clip(name)}" is not a program name.`,
      }
    }
  }
  return { ok: true, names }
}

export function commandBasename(command: string) {
  const base = command.trim().split(/[/\\]/).pop() ?? ""
  return base.replace(/\.(exe|cmd|bat)$/i, "")
}

export function isShellBasename(name: string) {
  return SHELLS.has(name.toLowerCase())
}

function posixDir(command: string) {
  if (!command.startsWith("/")) return null
  const parts: string[] = []
  for (const part of command.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    if (part.includes("\0")) return null
    parts.push(part)
  }
  if (parts.length < 2) return null
  parts.pop()
  return `/${parts.join("/")}/`
}

function windowsTrusted(command: string) {
  const slash = command.replace(/\\/g, "/")
  const match = slash.match(/^[a-zA-Z]:\/(.*)$/)
  if (!match) return false
  const parts: string[] = []
  for (const part of match[1].split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return false
      parts.pop()
      continue
    }
    if (part.includes("\0")) return false
    parts.push(part)
  }
  if (parts.length < 2) return false
  parts.pop()
  const dir = `${parts.join("/").toLowerCase()}/`
  return dir.includes("nodejs/") || dir.includes("windowsapps/")
}

function trustedCommandPath(command: string) {
  if (/^[a-zA-Z]:[\\/]/.test(command) || command.startsWith("\\\\")) {
    return windowsTrusted(command)
  }
  const dir = posixDir(command)
  if (!dir) return false
  return TRUSTED_COMMAND_DIRS.some((prefix) => dir === prefix || dir.startsWith(prefix))
}

function blockedEnvKey(name: string) {
  const key = name.toLowerCase()
  if (BLOCKED_ENV_EXACT.has(key)) return true
  return (
    key.startsWith("ld_") ||
    key.startsWith("dyld_") ||
    key.startsWith("npm_config_") ||
    key.startsWith("uv_index") ||
    key.startsWith("uv_python") ||
    key.startsWith("pip_index") ||
    key.startsWith("pip_find") ||
    key.startsWith("pip_trusted") ||
    key.startsWith("bash_func")
  )
}

export function mcpEnvRefusal(env: Record<string, string> | undefined): string | null {
  if (!env) return null
  for (const name of Object.keys(env)) {
    if (/[\0\r\n]/.test(name)) {
      return "Refused an MCP environment variable name containing a line break."
    }
    if (!blockedEnvKey(name)) continue
    return `Refused environment variable "${clip(name)}". Stdio env cannot set PATH, HOME, loader variables, interpreter flags, or a package index. Put tokens in ordinary names.`
  }
  return null
}

function isPath(command: string) {
  return command.includes("/") || command.includes("\\")
}

export function mcpCommandRefusal(
  command: string,
  args: string[],
  allowedExtension?: string
): string | null {
  const extension = extensionNames(allowedExtension)
  if (!extension.ok) return extension.error

  const trimmed = command.trim()
  if (!trimmed) return "A stdio MCP server needs a command."
  if (COMMAND_META.test(trimmed) || (!isPath(trimmed) && /\s/.test(trimmed))) {
    return `Refused command "${clip(trimmed)}". Use one executable and put arguments in args. Allowed launchers: ${LAUNCHER_LIST}.`
  }

  const base = commandBasename(trimmed)
  const allowed = new Set<string>([
    ...DEFAULT_MCP_LAUNCHERS.map((name) => name.toLowerCase()),
    ...extension.names.map((name) => name.toLowerCase()),
  ])
  if (!base || !allowed.has(base.toLowerCase())) {
    return `Refused command "${clip(trimmed)}". Stdio MCP servers can only start ${LAUNCHER_LIST}, or a program name you add with mcp.allowedCommands (XIRYN_MCP_ALLOWED_COMMANDS). Shells such as sh, bash and zsh are not allowed.`
  }

  if (isPath(trimmed) && !trustedCommandPath(trimmed)) {
    return `Refused command "${clip(trimmed)}". A full path is only accepted under a standard install location such as /usr/bin, /usr/local/bin, Homebrew, or the Windows Node.js directory. Use the program name to run the copy on PATH.`
  }

  if (isShellBasename(base) && args.some((arg) => ARG_SHELL_META.test(arg))) {
    return `Refused arguments for "${clip(trimmed)}". When the command is a shell, arguments cannot include shell metacharacters.`
  }
  return null
}

function sameArgs(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  )
}

// New stdio servers, and edits to command or args, must be confirmed. Benign
// env, headers, approval and enabled do not. Dangerous env is refused.
export function stdioLaunchesNeedingConfirmation(
  previous: McpServerShape[],
  next: McpServerShape[]
): StdioLaunch[] {
  const prior = new Map(previous.map((server) => [server.id, server]))
  const launches: StdioLaunch[] = []
  for (const server of next) {
    if (server.transport !== "stdio") continue
    const command = server.command?.trim() ?? ""
    const args = server.args ?? []
    const old = prior.get(server.id)
    const changed =
      !old ||
      old.transport !== "stdio" ||
      (old.command?.trim() ?? "") !== command ||
      !sameArgs(old.args ?? [], args)
    if (changed) launches.push({ id: server.id, command, args: [...args] })
  }
  launches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return launches
}
