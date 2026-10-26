import { sameSite } from "@/lib/etld"
import { ARGS_DIFFER_REASON } from "@/lib/mcp/approval"

// Whether vault_fill may type a login. Cards and UPI IDs are unchanged:
// they still go through request_payment_approval. There is no per-item
// "allow without asking"; each login fill asks, and the approval is consumed
// when that exact call runs.

export type LoginFillStep =
  | { action: "continue" }
  | { action: "refuse"; message: string }
  | { action: "ask"; summary: string; host: string }
  | { action: "fill"; host: string }

export function assessLoginFill(input: {
  kind: string
  label: string
  site: string | null
  field: string
  pageHost: string | null
  approved: boolean
}): LoginFillStep {
  if (input.kind !== "login") return { action: "continue" }

  const host = input.pageHost
  if (!host || !sameSite(host, input.site)) {
    const where = host ?? "not a confirmed website"
    const saved = input.site ?? "an unknown site"
    return {
      action: "refuse",
      message: `"${input.label}" is a login for ${saved}, but the focused page is ${where}. Logins only fill when that page's site matches the saved one.`,
    }
  }
  if (!input.approved) {
    const field = input.field.replace(/_/g, " ")
    return {
      action: "ask",
      host,
      // Host first. The stored summary is cut at 300 characters, and a
      // hostname can be 253 of those; the registrable domain sits at the end.
      summary: `On ${host}, fill the ${field} for “${input.label}”`,
    }
  }
  return { action: "fill", host }
}

// Bound to the call the person approved. The secret is not an argument.
export function loginApprovalArgs(input: {
  id: string
  field: string
  host: string
  label: string
  x?: number
  y?: number
}) {
  const args: {
    id: string
    field: string
    host: string
    label: string
    x?: number
    y?: number
  } = {
    id: input.id,
    field: input.field,
    host: input.host,
    label: input.label,
  }
  if (input.x !== undefined && input.y !== undefined) {
    args.x = input.x
    args.y = input.y
  }
  return args
}

// What the tool returns after a fill. Callers pass the hint, never the value.
export function vaultFillOutput(field: string, hint: string, host: string | null) {
  return {
    filled: field.replace(/_/g, " "),
    item: hint,
    site: host,
  }
}

export const TERMINAL_TIMEOUT_SECONDS = 120
export const MAX_SECRET_BYTES = 16_384
export const TERMINAL_OUTPUT_LIMIT = 20_000
const MAX_COMMAND_JSON = 1_500
const MAX_ARGS = 32
const MAX_ARG_CHARS = 4_096

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const BLOCKED_ENV = new Set([
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "IFS",
  "ENV",
  "BASH_ENV",
  "BASHOPTS",
  "SHELLOPTS",
  "CDPATH",
  "GLOBIGNORE",
  "PS4",
  "PROMPT_COMMAND",
  "ZDOTDIR",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "PYTHONINSPECT",
  "PERL5OPT",
  "PERL5LIB",
  "PERLLIB",
  "RUBYOPT",
  "RUBYLIB",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_EXEC_PATH",
  "SSLKEYLOGFILE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "DISPLAY",
  "XAUTHORITY",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "HOSTALIASES",
  "RES_OPTIONS",
])

export type TerminalVia = "stdin" | "env"

export type TerminalSpec = {
  command: string[]
  via: TerminalVia
  envName: string | null
  cwd: string | null
}

export function parseTerminalSpec(input: {
  command: unknown
  via: unknown
  envName: unknown
  cwd: unknown
}): { ok: true; spec: TerminalSpec } | { ok: false; message: string } {
  if (
    !Array.isArray(input.command) ||
    input.command.length < 1 ||
    input.command.length > MAX_ARGS
  ) {
    return {
      ok: false,
      message:
        "Terminal fill needs command: the program and its arguments, with no shell. There is no file to read.",
    }
  }
  const command: string[] = []
  for (const part of input.command) {
    if (
      typeof part !== "string" ||
      part.length > MAX_ARG_CHARS ||
      /[\0\r\n]/.test(part)
    ) {
      return {
        ok: false,
        message: "Each part of command must be a single line of text.",
      }
    }
    command.push(part)
  }
  if (!command[0]) {
    return { ok: false, message: "Name the program to run." }
  }
  if (JSON.stringify(command).length > MAX_COMMAND_JSON) {
    return {
      ok: false,
      message:
        "That command is too long to show in full on the approval card. Shorten it.",
    }
  }
  if (input.via !== "stdin" && input.via !== "env") {
    return {
      ok: false,
      message:
        'Set via to "stdin" or "env". The value is passed only that way, never as a file.',
    }
  }
  let envName: string | null = null
  if (input.via === "env") {
    if (typeof input.envName !== "string" || !ENV_NAME.test(input.envName)) {
      return {
        ok: false,
        message: "env needs envName: a variable such as GH_TOKEN.",
      }
    }
    const upper = input.envName.toUpperCase()
    if (BLOCKED_ENV.has(upper) || upper.startsWith("LD_") || upper.startsWith("DYLD_")) {
      return {
        ok: false,
        message: `“${input.envName}” can't carry a vault value. Pick a name like GH_TOKEN.`,
      }
    }
    envName = input.envName
  }
  let cwd: string | null = null
  if (input.cwd != null && input.cwd !== "") {
    if (
      typeof input.cwd !== "string" ||
      !input.cwd.startsWith("/") ||
      input.cwd.length > 512
    ) {
      return { ok: false, message: "cwd must be an absolute path on the workstation." }
    }
    if (/[\0\r\n]/.test(input.cwd) || input.cwd.split("/").includes("..")) {
      return { ok: false, message: "cwd must be an absolute path on the workstation." }
    }
    cwd = input.cwd
  }
  return { ok: true, spec: { command, via: input.via, envName, cwd } }
}

// The exact command the person approves. A different program, argument,
// variable, or directory is a different call and will not run.
export function terminalApprovalArgs(input: {
  id: string
  field: string
  label: string
  spec: TerminalSpec
}) {
  const args: {
    id: string
    field: string
    host: string
    label: string
    terminal: true
    command: string[]
    via: TerminalVia
    envName?: string
    cwd?: string
  } = {
    id: input.id,
    field: input.field,
    host: "terminal",
    label: input.label,
    terminal: true,
    command: input.spec.command,
    via: input.spec.via,
  }
  if (input.spec.envName) args.envName = input.spec.envName
  if (input.spec.cwd) args.cwd = input.spec.cwd
  return args
}

export function secretExecArgs(
  spec: TerminalSpec,
  timeoutSeconds = TERMINAL_TIMEOUT_SECONDS
) {
  const args = ["xiryn-secret-exec", "--via", spec.via]
  if (spec.via === "env" && spec.envName) args.push("--env-name", spec.envName)
  args.push("--timeout", String(timeoutSeconds), "--", ...spec.command)
  return args
}

export function encodeSecretFrame(value: string) {
  const secret = Buffer.from(value, "utf8")
  if (secret.length < 1 || secret.length > MAX_SECRET_BYTES) {
    throw new Error("That vault field can't be passed to a program.")
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(secret.length)
  return { secret, frame: Buffer.concat([header, secret]) }
}

const REDACTION_TOKENS = ["[redacted]", "<redacted>", "***"] as const

export function redactionToken(secret: string) {
  for (const token of REDACTION_TOKENS) {
    if (!secret.includes(token)) return token
  }
  return "\uFFFD"
}

// Spellings a command can emit without really transforming the value.
// Longest first, so a shorter form doesn't split a longer one.
export function secretSpellings(secret: string) {
  const bytes = Buffer.from(secret, "utf8")
  const b64 = bytes.toString("base64")
  const b64url = bytes.toString("base64url")
  const hex = bytes.toString("hex")
  const forms = [
    secret,
    b64,
    b64.replace(/=+$/, ""),
    b64url,
    b64url.replace(/=+$/, ""),
    hex,
    hex.toUpperCase(),
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
  ]
  return [...new Set(forms.filter((form) => form.length > 0))].sort(
    (a, b) => b.length - a.length
  )
}

export function redactSecret(text: string, secret: string) {
  if (!text) return text
  let out = text
  if (secret) {
    const token = redactionToken(secret)
    for (const form of secretSpellings(secret)) {
      if (out.includes(form)) out = out.split(form).join(token)
    }
  }
  return out.replace(/\/tmp\/xiryn\/vault\/\S*/g, redactionToken(secret || "x"))
}

export function clipTerminalOutput(text: string) {
  if (text.length <= TERMINAL_OUTPUT_LIMIT) return text
  return `${text.slice(0, TERMINAL_OUTPUT_LIMIT)}\n… ${text.length - TERMINAL_OUTPUT_LIMIT} more characters truncated`
}

// What the tool returns after a terminal run. No path, no value.
export function vaultFillOutputTerminal(
  field: string,
  hint: string,
  result: {
    via: TerminalVia
    command: string[]
    exitCode: number | null
    output: string
  }
) {
  return {
    filled: field.replace(/_/g, " "),
    item: hint,
    mode: "terminal" as const,
    via: result.via,
    command: result.command,
    exitCode: result.exitCode,
    output: result.output,
  }
}

// What the model is allowed to see. Extra keys, including a value or a path, are dropped.
export function vaultFillForModel(output: {
  status?: unknown
  approvalId?: unknown
  summary?: unknown
  filled?: unknown
  item?: unknown
  site?: unknown
  mode?: unknown
  via?: unknown
  command?: unknown
  exitCode?: unknown
  output?: unknown
  reason?: unknown
  [key: string]: unknown
}) {
  if (output.status === "needs-approval") {
    return {
      type: "text" as const,
      value: JSON.stringify({
        status: "needs-approval",
        approvalId: typeof output.approvalId === "string" ? output.approvalId : "",
        summary: typeof output.summary === "string" ? output.summary : "",
      }),
    }
  }
  if (output.status === "rejected") {
    return {
      type: "text" as const,
      value: JSON.stringify({
        status: "rejected",
        reason: output.reason === ARGS_DIFFER_REASON ? ARGS_DIFFER_REASON : "Refused.",
      }),
    }
  }
  if (output.mode === "terminal") {
    const command = Array.isArray(output.command)
      ? output.command.filter((part): part is string => typeof part === "string")
      : []
    return {
      type: "text" as const,
      value: JSON.stringify({
        filled: typeof output.filled === "string" ? output.filled : "",
        item: typeof output.item === "string" ? output.item : "",
        mode: "terminal",
        via: output.via === "env" ? "env" : "stdin",
        command,
        exitCode: typeof output.exitCode === "number" ? output.exitCode : null,
        output: typeof output.output === "string" ? output.output : "",
      }),
    }
  }
  return {
    type: "text" as const,
    value: JSON.stringify({
      filled: typeof output.filled === "string" ? output.filled : "",
      item: typeof output.item === "string" ? output.item : "",
      site: typeof output.site === "string" ? output.site : null,
    }),
  }
}
