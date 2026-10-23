import { createMCPClient, type MCPClient } from "@ai-sdk/mcp"
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio"
import { tool, type ToolSet } from "ai"

import { toUntrustedModelOutput } from "@/lib/agent/untrusted"
import type { ToolEnv } from "@/lib/agent/tools"
import { expandEnv, readMcpConfig, type McpServerConfig } from "@/lib/mcp/config"
import { createGoogleTools } from "@/lib/mcp/google-tools"
import { holdOrRun } from "@/lib/mcp/guard"
import { connectorEnabled } from "@/lib/mcp/google"
import { toolNeedsApproval } from "@/lib/mcp/policy"

// External MCP clients stay open for the life of the process. Wrappers are
// built per turn so an approval is tied to that thread. stdio servers run on
// the Xiryn host, as the user who runs Xiryn, and only for commands written
// in mcp.json — an agent cannot choose the command.

const globalForMcp = globalThis as unknown as {
  __xirynMcp?: Map<string, Promise<MCPClient>>
}

function pool() {
  return (globalForMcp.__xirynMcp ??= new Map())
}

export function resetMcpClients() {
  const clients = globalForMcp.__xirynMcp
  if (!clients) return
  for (const pending of clients.values()) {
    pending.then((client) => client.close()).catch(() => {})
  }
  clients.clear()
}

function childEnv(server: McpServerConfig) {
  const env: Record<string, string> = {}
  for (const name of ["PATH", "HOME", "LANG", "USER", "LOGNAME", "TMPDIR"]) {
    const value = process.env[name]
    if (value) env[name] = value
  }
  for (const [name, value] of Object.entries(server.env ?? {}))
    env[name] = expandEnv(value)
  return env
}

async function openClient(server: McpServerConfig) {
  if (server.transport === "stdio") {
    return createMCPClient({
      name: "xiryn",
      transport: new Experimental_StdioMCPTransport({
        command: server.command!,
        args: server.args,
        env: childEnv(server),
        stderr: "inherit",
      }),
    })
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(server.headers ?? {})) {
    headers[name] = expandEnv(value)
  }
  return createMCPClient({
    name: "xiryn",
    transport: {
      type: server.transport,
      url: expandEnv(server.url!),
      headers,
      redirect: "error",
    },
  })
}

async function clientFor(server: McpServerConfig) {
  const key = JSON.stringify(server)
  const clients = pool()
  const existing = clients.get(key)
  if (existing) return existing
  const pending = openClient(server)
  clients.set(key, pending)
  try {
    return await pending
  } catch (error) {
    clients.delete(key)
    throw error
  }
}

function exposedName(serverId: string, name: string) {
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_")
  return `mcp_${serverId}_${clean}`.slice(0, 64)
}

async function toolsForServer(server: McpServerConfig, env: ToolEnv) {
  const client = await clientFor(server)
  const [listed, raw] = await Promise.all([client.listTools(), client.tools()])
  const hints = new Map<string, { readOnlyHint?: boolean; destructiveHint?: boolean }>()
  for (const item of listed.tools) {
    const annotations = item.annotations as
      { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined
    if (item.name) hints.set(item.name, annotations ?? {})
  }
  const tools: ToolSet = {}
  const names: string[] = []
  for (const [name, mcpTool] of Object.entries(raw) as [string, (typeof raw)[string]][]) {
    const exposed = exposedName(server.id, name)
    names.push(exposed)
    const annotation = hints.get(name)
    tools[exposed] = tool({
      description: `${mcpTool.description ?? name} (MCP ${server.id})`,
      inputSchema: mcpTool.inputSchema,
      execute: async (input) => {
        if (
          toolNeedsApproval(name, {
            mode: server.approval ?? "writes",
            approve: server.approve,
            readOnly: server.readOnly,
            readOnlyHint: annotation?.readOnlyHint,
            destructiveHint: annotation?.destructiveHint,
          })
        ) {
          const hold = await holdOrRun(env, {
            tool: exposed,
            summary: `${server.id}: ${name}`,
            args: input,
          })
          if (hold) return hold
        }
        return mcpTool.execute(input)
      },
      toModelOutput: ({ output }) => toUntrustedModelOutput(`mcp:${server.id}`, output),
    })
  }
  return { tools, names }
}

export async function loadConnectorTools(env: ToolEnv) {
  const tools: ToolSet = { ...(createGoogleTools(env) as ToolSet) }
  const lines: string[] = []
  if (connectorEnabled("gmail")) {
    lines.push(
      "Gmail is connected: gmail_search and gmail_read run immediately; gmail_draft, gmail_send and gmail_reply wait for approval and do nothing until the same call is approved."
    )
  }
  if (connectorEnabled("calendar")) {
    lines.push(
      "Google Calendar is connected: calendar_list_events runs immediately; calendar_create_event, calendar_update_event and calendar_delete_event wait for approval."
    )
  }

  const config = readMcpConfig()
  if (config.error) lines.push(`MCP config was not loaded: ${config.error}`)
  for (const server of config.servers) {
    if (server.enabled === false) continue
    try {
      const loaded = await toolsForServer(server, env)
      Object.assign(tools, loaded.tools)
      lines.push(`MCP server ${server.id}: ${loaded.names.join(", ") || "no tools"}.`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      lines.push(`MCP server ${server.id} is unavailable: ${reason}`)
      console.error(`[xiryn] mcp ${server.id}:`, error)
    }
  }

  return { tools, summary: lines.join("\n") }
}
