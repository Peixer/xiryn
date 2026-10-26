// Logs, the update screen, and work-session output must not grow a copy of
// .env, a vault key, or a bearer token. This runs on every progress line,
// audit error, and coding-CLI chunk before that text is stored or shown.

const SECRET_ASSIGN =
  /\b(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)[A-Z0-9_]*)\s*[=:]\s*\S+/gi
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi
const AWS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
const BASIC = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi
const ENV_LINE = /^(?:export\s+)?[A-Z][A-Z0-9_]*\s*=\s*\S+/gm
const GITHUB_FINE = /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{36}\b/g
const MODEL_KEY =
  /\bsk-(?:proj-|svcacct-|admin-|ant-(?:api\d{2}|admin\d{2})-)?[A-Za-z0-9_-]{20,}/g
// user:password@, including a password that itself contains @. The scheme is kept.
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+:\S+)@/gi
const PEM =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g

const PREFIXES = [
  "-----BEGIN ",
  "github_pat_",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "sk-",
  "AKIA",
  "ASIA",
]
const PEM_HOLDBACK = 8_192
const TOKEN_HOLDBACK = 512

export function redact(text: string) {
  return text
    .replace(PEM, "[redacted]")
    .replace(CREDENTIAL_URL, "$1[redacted]@")
    .replace(GITHUB_FINE, "[redacted]")
    .replace(GITHUB_TOKEN, "[redacted]")
    .replace(MODEL_KEY, "[redacted]")
    .replace(SECRET_ASSIGN, (match) => match.replace(/[=:]\s*\S+/, "= [redacted]"))
    .replace(BEARER, "Bearer [redacted]")
    .replace(BASIC, "Basic [redacted]")
    .replace(AWS_KEY, "[redacted]")
    .replace(ENV_LINE, (line) => {
      const eq = line.indexOf("=")
      return `${line.slice(0, eq + 1)} [redacted]`
    })
}

export function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return redact(message).slice(0, 500)
}

// A secret split across CLI chunks is still one secret once the pieces sit
// in the same buffer. Hold back a trailing fragment that is too short to
// match, so the raw prefix is not written before the rest arrives. `flush`
// is the end of the session: nothing further is coming.
export function redactForStorage(text: string, flush = false) {
  if (flush || !text) return redact(text)
  const pem = openPrivateKeyHold(text)
  if (pem > 0) return redact(text.slice(0, -pem))
  if (/\s$/.test(text)) return redact(text)
  const tailAt = Math.max(
    text.lastIndexOf("\n"),
    text.lastIndexOf(" "),
    text.lastIndexOf("\t"),
    text.lastIndexOf("\r")
  )
  const tail = text.slice(tailAt + 1)
  const at = secretPrefixStart(tail)
  if (at === -1) return redact(text)
  const secret = tail.slice(at)
  if (secret.length > TOKEN_HOLDBACK) return redact(text)
  if (redact(secret) !== secret) return redact(text)
  return redact(text.slice(0, text.length - secret.length))
}

function openPrivateKeyHold(text: string) {
  const start = Math.max(0, text.length - PEM_HOLDBACK)
  const window = text.slice(start)
  const begin = window.lastIndexOf("-----BEGIN ")
  if (begin === -1) return 0
  const block = window.slice(begin)
  if (!block.includes("PRIVATE KEY-----")) return 0
  if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(block)) return 0
  return block.length
}

function secretPrefixStart(tail: string) {
  let best = -1
  for (const prefix of PREFIXES) {
    const at = tail.lastIndexOf(prefix)
    if (at > best) best = at
  }
  for (const match of tail.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^/\s:@]*:/gi)) {
    if (match.index !== undefined && match.index > best) best = match.index
  }
  return best
}
