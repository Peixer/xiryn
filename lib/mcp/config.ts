import fs from "node:fs"

import { z } from "zod"

import { DATA_DIR } from "@/db"

// Operator-configured MCP servers. The file lives in the data directory, next
// to the database, and is never committed. Agents cannot add servers; they
// only call tools the file already lists.

export const MCP_CONFIG_PATH = `${DATA_DIR}/mcp.json`

const serverSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/, "Server id: lowercase letters, digits, hyphens."),
    enabled: z.boolean().optional(),
    transport: z.enum(["stdio", "http", "sse"]),
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string()).max(40).optional(),
    url: z.string().trim().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    approval: z.enum(["writes", "all", "none"]).optional(),
    approve: z.array(z.string()).max(80).optional(),
    readOnly: z.array(z.string()).max(80).optional(),
  })
  .superRefine((server, ctx) => {
    if (server.transport === "stdio" && !server.command) {
      ctx.addIssue({
        code: "custom",
        message: `${server.id} needs a command.`,
        path: ["command"],
      })
    }
    if (server.transport !== "stdio" && !server.url) {
      ctx.addIssue({
        code: "custom",
        message: `${server.id} needs a url.`,
        path: ["url"],
      })
    }
    if (server.command && /[\n\r]/.test(server.command)) {
      ctx.addIssue({
        code: "custom",
        message: "The command must be one executable, with arguments in args.",
        path: ["command"],
      })
    }
  })

const fileSchema = z.object({
  servers: z.array(serverSchema).max(20),
})

export type McpServerConfig = z.infer<typeof serverSchema>

export function readMcpConfig(): { servers: McpServerConfig[]; error: string | null } {
  if (!fs.existsSync(MCP_CONFIG_PATH)) return { servers: [], error: null }
  try {
    const parsed = fileSchema.parse(JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf8")))
    const ids = new Set<string>()
    for (const server of parsed.servers) {
      if (ids.has(server.id)) {
        return { servers: [], error: `Two servers share the id "${server.id}".` }
      }
      ids.add(server.id)
    }
    return { servers: parsed.servers, error: null }
  } catch (error) {
    return {
      servers: [],
      error: error instanceof Error ? error.message : "mcp.json could not be read.",
    }
  }
}

export function parseMcpConfig(text: string) {
  const parsed = fileSchema.parse(JSON.parse(text))
  const ids = new Set<string>()
  for (const server of parsed.servers) {
    if (ids.has(server.id)) throw new Error(`Two servers share the id "${server.id}".`)
    ids.add(server.id)
  }
  return parsed
}

export function writeMcpConfig(text: string) {
  const parsed = parseMcpConfig(text)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${MCP_CONFIG_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, MCP_CONFIG_PATH)
  fs.chmodSync(MCP_CONFIG_PATH, 0o600)
  return parsed.servers
}

// ${ENV:NAME} pulls a secret from the environment so it need not sit in mcp.json.
export function expandEnv(value: string) {
  return value.replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const found = process.env[name]?.trim()
    if (!found) throw new Error(`MCP config references ${name}, which is not set.`)
    return found
  })
}
