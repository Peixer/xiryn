"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { disconnectGoogleAccount, saveMcpConfig } from "@/actions/connectors"
import { saveSettings } from "@/actions/settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { SettingsData } from "@/queries/workspace"

const EXAMPLE = `{
  "servers": [
    {
      "id": "docs",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer \${ENV:DOCS_MCP_TOKEN}" },
      "approval": "writes"
    }
  ]
}
`

export function ConnectorsPanel({
  connectors,
}: {
  connectors: SettingsData["connectors"]
}) {
  const router = useRouter()
  const [text, setText] = React.useState(connectors.mcpText)
  const [pending, setPending] = React.useState<string | null>(null)
  const [clientId, setClientId] = React.useState("")
  const [clientSecret, setClientSecret] = React.useState("")

  const saveGoogle = async () => {
    setPending("google")
    try {
      const values: Record<string, string | null> = {}
      if (clientId.trim()) values["google.clientId"] = clientId.trim()
      if (clientSecret.trim()) values["google.clientSecret"] = clientSecret.trim()
      if (Object.keys(values).length === 0) return
      await saveSettings(values)
      setClientId("")
      setClientSecret("")
      toast.add({ type: "success", title: "Google app saved" })
      router.refresh()
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't save",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPending(null)
    }
  }

  const toggle = async (key: "connectors.gmail" | "connectors.calendar", on: boolean) => {
    setPending(key)
    try {
      await saveSettings({ [key]: on ? null : "off" })
      router.refresh()
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't save",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium">Gmail and Google Calendar</span>
          <span className="rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
            {connectors.connected ? "connected" : "not connected"}
          </span>
        </div>
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
          Built in, so the consent screen can finish on this server. Create a Google Cloud
          OAuth client (Web application) and set its redirect URI to the address below.
          The steps are in docs/mcp.md. Sending mail and changing the calendar wait for
          your approval.
        </p>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {connectors.redirectUri ??
            "Set XIRYN_URL to https://your-host so the redirect URI can be shown."}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono">Client id · GOOGLE_CLIENT_ID</span>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder={
              connectors.clientId.value
                ? `${connectors.clientId.value}  (leave empty to keep)`
                : "1234567890-abc.apps.googleusercontent.com"
            }
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 font-mono text-[12px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono">Client secret · GOOGLE_CLIENT_SECRET</span>
          <input
            type="password"
            autoComplete="off"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={
              connectors.clientSecret.value
                ? `${connectors.clientSecret.value}  (leave empty to keep)`
                : "Paste secret"
            }
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 font-mono text-[12px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending === "google"} onClick={saveGoogle}>
            {pending === "google" && <Spinner data-icon="inline-start" />}
            Save Google app
          </Button>
          {connectors.clientId.set && connectors.clientSecret.set && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href="/api/google/oauth/start" />}
            >
              {connectors.connected ? "Reconnect Google" : "Connect Google"}
            </Button>
          )}
          {connectors.connected && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={async () => {
                setPending("disconnect")
                await disconnectGoogleAccount()
                setPending(null)
                toast.add({ type: "success", title: "Google disconnected" })
                router.refresh()
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
        <label className="flex items-start gap-2.5">
          <Checkbox
            checked={connectors.gmail.value !== "off"}
            disabled={!connectors.connected || pending === "connectors.gmail"}
            onCheckedChange={(checked) => toggle("connectors.gmail", checked === true)}
            className="mt-0.5"
          />
          <span className="text-[13px]">Gmail tools</span>
        </label>
        <label className="flex items-start gap-2.5">
          <Checkbox
            checked={connectors.calendar.value !== "off"}
            disabled={!connectors.connected || pending === "connectors.calendar"}
            onCheckedChange={(checked) => toggle("connectors.calendar", checked === true)}
            className="mt-0.5"
          />
          <span className="text-[13px]">Calendar tools</span>
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13.5px] font-medium">Other MCP servers</span>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            stdio and streamable HTTP. Saved to{" "}
            <span className="font-mono">{connectors.mcpPath}</span>, mode 600, not in git.
            Put secrets in the environment and refer to them as{" "}
            <span className="font-mono">{"${ENV:NAME}"}</span>. Write and send tools wait
            for approval unless a server sets <span className="font-mono">approval</span>{" "}
            to <span className="font-mono">none</span>.
          </p>
        </div>
        {connectors.servers.length > 0 && (
          <ul className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
            {connectors.servers.map((server) => (
              <li key={server.id}>
                {server.enabled ? "on" : "off"} · {server.transport} · {server.id}
              </li>
            ))}
          </ul>
        )}
        {connectors.mcpError && (
          <p className="text-[12px] text-destructive">{connectors.mcpError}</p>
        )}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={EXAMPLE}
          spellCheck={false}
          rows={12}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <div>
          <Button
            size="sm"
            disabled={pending === "mcp"}
            onClick={async () => {
              setPending("mcp")
              const result = await saveMcpConfig(text)
              setPending(null)
              if (!result.ok) {
                toast.add({
                  type: "error",
                  title: "Couldn't save",
                  description: result.error,
                })
                return
              }
              toast.add({ type: "success", title: "MCP servers saved" })
              router.refresh()
            }}
          >
            {pending === "mcp" && <Spinner data-icon="inline-start" />}
            Save MCP servers
          </Button>
        </div>
      </div>
    </div>
  )
}
