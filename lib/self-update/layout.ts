import { isBranchName, isSha } from "@/lib/self-update/sha"
import type { Colour } from "@/lib/self-update/state"

export type Layout = {
  branch: string
  remote: string
  mirror: string
  blueDir: string
  greenDir: string
  blueData: string
  greenData: string
  bluePort: number
  greenPort: number
  blueDesktopPort: number
  greenDesktopPort: number
  backupDir: string
  deployDir: string
  caddyfile: string
  caddySnippet: string
  standbyUrl: string | null
  sharedEnv: string
  vaultDir: string
  maintenanceFile: string
}

export const DEFAULT_LAYOUT: Layout = {
  branch: "main",
  remote: "https://github.com/Peixer/xiryn.git",
  mirror: "/var/lib/xiryn-pin.git",
  blueDir: "/opt/xiryn-blue",
  greenDir: "/opt/xiryn-green",
  blueData: "/var/lib/xiryn/colours/blue",
  greenData: "/var/lib/xiryn/colours/green",
  bluePort: 6796,
  greenPort: 6896,
  blueDesktopPort: 6797,
  greenDesktopPort: 6897,
  backupDir: "/var/backups/xiryn",
  deployDir: "/var/lib/xiryn/deploy",
  caddyfile: "/etc/caddy/Caddyfile",
  caddySnippet: "/etc/caddy/xiryn-upstreams.caddy",
  standbyUrl: null,
  sharedEnv: "/etc/xiryn/shared.env",
  vaultDir: "/etc/xiryn/vault",
  maintenanceFile: "/etc/xiryn/maintenance",
}

const PATH = /^\/[A-Za-z0-9._+/-]+$/
const REMOTE = /^https:\/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._~+/-]+)+$/

function port(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} is not a port.`)
  const number = Number(value)
  if (number < 1024 || number > 65535) throw new Error(`${label} is not a usable port.`)
  return number
}

function absPath(value: string, label: string) {
  if (!PATH.test(value) || value.includes(".."))
    throw new Error(`${label} is not a safe path.`)
  return value
}

function standby(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("STANDBY_URL is not a URL.")
  }
  if (url.username || url.password || url.protocol !== "https:") {
    throw new Error("STANDBY_URL must be https with no userinfo.")
  }
  return url.origin
}

export function parseDeployConf(text: string, base: Layout = DEFAULT_LAYOUT): Layout {
  const next: Layout = { ...base }
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) throw new Error("A deploy config line is missing a value.")
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (value.includes("\n") || value.includes("`") || value.includes("$")) {
      throw new Error("A deploy config value is not plain text.")
    }
    switch (key) {
      case "BRANCH":
        if (!isBranchName(value)) throw new Error("BRANCH is not a single branch name.")
        next.branch = value
        break
      case "REMOTE":
        if (!REMOTE.test(value)) throw new Error("REMOTE must be an https git URL.")
        next.remote = value
        break
      case "MIRROR":
        next.mirror = absPath(value, "MIRROR")
        break
      case "BLUE_DIR":
        next.blueDir = absPath(value, "BLUE_DIR")
        break
      case "GREEN_DIR":
        next.greenDir = absPath(value, "GREEN_DIR")
        break
      case "BLUE_DATA":
        next.blueData = absPath(value, "BLUE_DATA")
        break
      case "GREEN_DATA":
        next.greenData = absPath(value, "GREEN_DATA")
        break
      case "BLUE_PORT":
        next.bluePort = port(value, "BLUE_PORT")
        break
      case "GREEN_PORT":
        next.greenPort = port(value, "GREEN_PORT")
        break
      case "BLUE_DESKTOP_PORT":
        next.blueDesktopPort = port(value, "BLUE_DESKTOP_PORT")
        break
      case "GREEN_DESKTOP_PORT":
        next.greenDesktopPort = port(value, "GREEN_DESKTOP_PORT")
        break
      case "BACKUP_DIR":
        next.backupDir = absPath(value, "BACKUP_DIR")
        break
      case "DEPLOY_DIR":
        next.deployDir = absPath(value, "DEPLOY_DIR")
        break
      case "CADDYFILE":
        next.caddyfile = absPath(value, "CADDYFILE")
        break
      case "CADDY_SNIPPET":
        next.caddySnippet = absPath(value, "CADDY_SNIPPET")
        break
      case "STANDBY_URL":
        next.standbyUrl = standby(value)
        break
      case "SHARED_ENV":
        next.sharedEnv = absPath(value, "SHARED_ENV")
        break
      case "VAULT_DIR":
        next.vaultDir = absPath(value, "VAULT_DIR")
        break
      case "MAINTENANCE_FILE":
        next.maintenanceFile = absPath(value, "MAINTENANCE_FILE")
        break
      default:
        throw new Error(`Unknown deploy setting ${key}.`)
    }
  }
  const ports = [
    next.bluePort,
    next.greenPort,
    next.blueDesktopPort,
    next.greenDesktopPort,
  ]
  if (new Set(ports).size !== ports.length)
    throw new Error("Colour ports must be distinct.")
  return next
}

export function colourDir(layout: Layout, colour: Colour) {
  return colour === "blue" ? layout.blueDir : layout.greenDir
}

export function colourData(layout: Layout, colour: Colour) {
  return colour === "blue" ? layout.blueData : layout.greenData
}

export function colourPort(layout: Layout, colour: Colour) {
  return colour === "blue" ? layout.bluePort : layout.greenPort
}

export function colourDesktopPort(layout: Layout, colour: Colour) {
  return colour === "blue" ? layout.blueDesktopPort : layout.greenDesktopPort
}

export function colourUnit(colour: Colour) {
  return colour === "blue" ? "xiryn-blue" : "xiryn-green"
}

export function assertSha(value: string) {
  if (!isSha(value)) throw new Error("Refusing a command that is not pinned to a commit.")
  return value
}
