import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export type CodingTool = "codex" | "claude-code"
export type SessionRunner = (
  command: string[],
  options: { cwd: string; timeoutMs: number; onOutput?: (line: string) => void }
) => Promise<{ exitCode: number; text: string }>
export type CodingSessionOptions = {
  tool: CodingTool
  task: string
  workdir: string
  model?: string
  timeoutMs?: number
  onOutput?: (line: string) => void
  run?: SessionRunner
}
export type CodingSessionResult = {
  text: string
  exitCode: number
  durationMs: number
  ok: boolean
  error?: string
}
function executable(candidates: string[]) {
  return (
    candidates.find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    }) ?? null
  )
}
export function resolveCodexBin(): string | null {
  return executable([
    path.join(os.homedir(), "codex-cli/node_modules/.bin/codex"),
    path.join(os.homedir(), ".local/bin/codex"),
    "/usr/local/bin/codex",
  ])
}
export function resolveClaudeBin(): string | null {
  return executable([
    path.join(os.homedir(), ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ])
}
const localRun: SessionRunner = (command, opts) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
    let text = ""
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-proc.pid!, signal)
      } catch {
        /* Process exited. */
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill("SIGTERM")
      killTimer = setTimeout(() => kill("SIGKILL"), 5000)
    }, opts.timeoutMs)
    const handle = (data: Buffer) => {
      const chunk = data.toString()
      text += chunk
      opts.onOutput?.(chunk)
    }
    proc.stdout.on("data", handle)
    proc.stderr.on("data", handle)
    proc.on("error", (err) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      reject(err)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      if (timedOut) reject(new Error(`Timed out after ${opts.timeoutMs}ms`))
      else resolve({ text, exitCode: code ?? -1 })
    })
  })
export async function runCodingSession(
  opts: CodingSessionOptions
): Promise<CodingSessionResult> {
  const startedAt = Date.now()
  // Workstation runners resolve binaries inside the container, never on the host.
  const bin = opts.run
    ? opts.tool === "codex"
      ? "/home/xiryn/.local/bin/codex"
      : "/home/xiryn/.local/bin/claude"
    : opts.tool === "codex"
      ? resolveCodexBin()
      : resolveClaudeBin()
  if (!bin)
    return {
      text: `${opts.tool} CLI not found`,
      exitCode: 1,
      durationMs: 0,
      ok: false,
      error: `${opts.tool} CLI not found`,
    }
  const args =
    opts.tool === "codex"
      ? [
          "exec",
          "--dangerously-bypass-approvals-and-sandbox",
          "-m",
          opts.model ?? "gpt-6.1-sol",
          opts.task,
        ]
      : [
          "-p",
          opts.task,
          "--output-format",
          "stream-json",
          "--verbose",
          "--dangerously-skip-permissions",
          ...(opts.model ? ["--model", opts.model] : []),
        ]
  try {
    const result = await (opts.run ?? localRun)([bin, ...args], {
      cwd: opts.workdir,
      timeoutMs: opts.timeoutMs ?? 900_000,
      onOutput: opts.onOutput,
    })
    return {
      ...result,
      durationMs: Date.now() - startedAt,
      ok: result.exitCode === 0,
      ...(result.exitCode ? { error: `CLI exited with code ${result.exitCode}` } : {}),
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return {
      text: error,
      error,
      exitCode: -1,
      durationMs: Date.now() - startedAt,
      ok: false,
    }
  }
}
