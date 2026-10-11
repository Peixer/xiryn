#!/usr/bin/env node
// First-run helper: checks Node, creates .env from the template, and tells
// you which keys are still missing. Never prints a key's value.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`
const warn = (s) => `\x1b[33m!\x1b[0m ${s}`
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`

console.log("\n  oryn · setup\n")

const [major, minor] = process.versions.node.split(".").map(Number)
if (major < 20 || (major === 20 && minor < 9)) {
  console.log(bad(`Node ${process.versions.node} is too old — Oryn needs 20.9 or newer.`))
  process.exit(1)
}
console.log(ok(`node ${process.versions.node}`))

const envPath = path.join(root, ".env")
if (!existsSync(envPath)) {
  copyFileSync(path.join(root, ".env.example"), envPath)
  console.log(ok(`created .env ${dim("from .env.example")}`))
} else {
  console.log(ok(`.env exists ${dim("(left untouched)")}`))
}

mkdirSync(path.join(root, process.env.ORYN_DATA_DIR || "data"), { recursive: true })

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf("=")
      return [
        line.slice(0, i),
        line
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ]
    })
)
const has = (key) => !!env[key]

const providers = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_BASE_URL",
  "LMSTUDIO_BASE_URL",
  "CUSTOM_BASE_URL",
].filter(has)

console.log()
console.log(
  providers.length
    ? ok(
        `model provider${providers.length > 1 ? "s" : ""}: ${providers.map((k) => k.replace(/_(API_KEY|BASE_URL)$/, "").toLowerCase()).join(", ")}`
      )
    : warn("no model provider yet — add one key to .env (or later in Settings)")
)
console.log(
  has("DAYTONA_API_KEY")
    ? ok("workstations: daytona")
    : warn(`workstations off ${dim("— DAYTONA_API_KEY")}`)
)
console.log(
  has("FIRECRAWL_API_KEY")
    ? ok("web: firecrawl")
    : warn(`web off ${dim("— FIRECRAWL_API_KEY")}`)
)
console.log(
  has("TELEGRAM_BOT_TOKEN")
    ? ok("remote: telegram")
    : dim("  remote access off — optional, see docs/telegram.md")
)

console.log(`\n  next: ${"\x1b[1m"}npm run dev${"\x1b[0m"}  →  http://127.0.0.1:6796\n`)
