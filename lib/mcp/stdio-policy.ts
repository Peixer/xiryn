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

  if (SHELLS.has(base.toLowerCase()) && args.some((arg) => ARG_SHELL_META.test(arg))) {
    return `Refused arguments for "${clip(trimmed)}". When the command is a shell, arguments cannot include shell metacharacters.`
  }
  return null
}

function sameArgs(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  )
}

// New stdio servers, and edits to command or args, must be confirmed. Env,
// headers, approval and enabled are ignored here.
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
