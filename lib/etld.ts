import fs from "node:fs"
import path from "node:path"
import { isIP } from "node:net"
import { domainToASCII } from "node:url"
import { fileURLToPath } from "node:url"

// eTLD+1 using the Public Suffix List. Two hosts match only when they share a
// registrable domain, so attacker.github.io does not match victim.github.io
// and evil.co.uk does not match barclays.co.uk.

type Rule = { suffix: string; wildcard: boolean; exception: boolean }

let rules: Map<string, Rule> | null = null
let unavailable = false

function listText() {
  // Beside this module when tests and the server run from the repo. The
  // ignore comment keeps the build from tracing the whole project for a
  // path it cannot see statically.
  const beside = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "public_suffix_list.dat"
  )
  const fromRoot = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "lib",
    "public_suffix_list.dat"
  )
  const file = fs.existsSync(/*turbopackIgnore: true*/ beside) ? beside : fromRoot
  return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")
}

function ruleMap() {
  if (rules) return rules
  if (unavailable) return null
  try {
    const map = new Map<string, Rule>()
    for (const line of listText().split("\n")) {
      const raw = line.trim().toLowerCase()
      if (!raw || raw.startsWith("//")) continue
      const exception = raw.startsWith("!")
      const wildcard = raw.startsWith("*.")
      const suffix = domainToASCII(raw.replace(/^(\*\.|!)/, "")).toLowerCase()
      if (!suffix) continue
      map.set(suffix, { suffix, wildcard, exception })
    }
    rules = map
    return map
  } catch {
    unavailable = true
    return null
  }
}

function canonical(input: string | null) {
  if (!input) return null
  let host = input.trim().toLowerCase()
  if (!host) return null
  if (host.includes("://") || host.includes("/")) {
    try {
      host = new URL(host.includes("://") ? host : `https://${host}`).hostname
    } catch {
      return null
    }
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1)
  if (host.endsWith(".")) host = host.slice(0, -1)
  if (isIP(host)) return host
  const ascii = domainToASCII(host).toLowerCase()
  return ascii || null
}

function labelsOk(domain: string) {
  if (domain.length > 255) return false
  return domain.split(".").every((label) => {
    return (
      label.length >= 1 &&
      label.length <= 63 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[a-z0-9-]+$/.test(label)
    )
  })
}

function findRule(map: Map<string, Rule>, domain: string) {
  const chunks = domain.split(".")
  for (let i = 0; i < chunks.length; i++) {
    const rule = map.get(chunks.slice(i).join("."))
    if (rule) return rule
  }
  return null
}

// The registrable domain, or null when the host is an IP, a public suffix
// itself, or the list could not be read. Callers then fail closed.
export function registrableDomain(host: string) {
  const domain = canonical(host)
  if (!domain || isIP(domain) || !labelsOk(domain)) return null
  const map = ruleMap()
  if (!map) return null
  const parts = domain.split(".")
  const rule = findRule(map, domain)
  if (!rule) {
    if (parts.length < 2) return null
    return parts.slice(-2).join(".")
  }
  const tldParts = rule.suffix.split(".")
  const privateParts = parts.slice(0, parts.length - tldParts.length)
  if (rule.exception) {
    const moved = tldParts.shift()
    if (moved) privateParts.push(moved)
  }
  if (rule.wildcard) {
    const extra = privateParts.pop()
    if (!extra) return null
    tldParts.unshift(extra)
  }
  if (privateParts.length === 0) return null
  const sld = privateParts.pop()
  if (!sld) return null
  return [sld, ...tldParts].join(".")
}

// True when both hosts are the same address, or the same registrable domain.
export function sameSite(pageHost: string | null, savedSite: string | null) {
  const page = canonical(pageHost)
  const saved = canonical(savedSite)
  if (!page || !saved) return false
  if (isIP(page) || isIP(saved)) return page === saved
  const pageDomain = registrableDomain(page)
  const savedDomain = registrableDomain(saved)
  if (pageDomain && savedDomain) return pageDomain === savedDomain
  return page === saved
}
