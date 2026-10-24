// Logs and the update screen must not grow a copy of .env, a vault key,
// or a bearer token. This runs on every progress line and audit error.

const SECRET_ASSIGN =
  /\b(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)[A-Z0-9_]*)\s*[=:]\s*\S+/gi
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi
const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g
const BASIC = /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi
const ENV_LINE = /^(?:export\s+)?[A-Z][A-Z0-9_]*\s*=\s*\S+/gm

export function redact(text: string) {
  return text
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
