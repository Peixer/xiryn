"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  disconnectGoogleAccount,
  issueMcpStdioConfirmation,
  saveMcpConfig,
  testDriveConnection,
} from "@/actions/connectors"
import { saveSettings } from "@/actions/settings"
import { Confirm } from "@/components/confirm"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { describeDriveGrant, driveCapabilities } from "@/lib/mcp/drive-scopes"
import { DEFAULT_MCP_LAUNCHERS } from "@/lib/mcp/stdio-policy"
import type { SettingsData } from "@/queries/workspace"

type StdioReview = {
  text: string
  launches: { id: string; command: string; args: string[] }[]
}

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
  const [allowed, setAllowed] = React.useState(connectors.allowedCommands.value ?? "")
  const [importHosts, setImportHosts] = React.useState(connectors.importHosts.value ?? "")
  const [pending, setPending] = React.useState<string | null>(null)
  const [review, setReview] = React.useState<StdioReview | null>(null)
  const [clientId, setClientId] = React.useState("")
  const [clientSecret, setClientSecret] = React.useState("")
  const [driveResult, setDriveResult] = React.useState<string | null>(null)
  const [driveOk, setDriveOk] = React.useState(false)

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

  const saveImportHosts = async () => {
    setPending("hosts")
    try {
      await saveSettings({
        "grokbot.importHosts": importHosts.trim() ? importHosts.trim() : null,
      })
      toast.add({ type: "success", title: "Import hosts saved" })
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

  const saveAllowed = async () => {
    setPending("allow")
    try {
      await saveSettings({
        "mcp.allowedCommands": allowed.trim() ? allowed.trim() : null,
      })
      toast.add({ type: "success", title: "Extra programs saved" })
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

  const saveMcp = async () => {
    setPending("mcp")
    try {
      const result = await saveMcpConfig(text)
      if (!result.ok) {
        if (result.confirm?.length) {
          setReview({ text, launches: result.confirm })
          return
        }
        toast.add({ type: "error", title: "Couldn't save", description: result.error })
        return
      }
      toast.add({ type: "success", title: "MCP servers saved" })
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  const confirmMcp = async () => {
    if (!review) return
    const issued = await issueMcpStdioConfirmation(review.text)
    if (!issued.ok) {
      toast.add({ type: "error", title: "Couldn't save", description: issued.error })
      return
    }
    const result = await saveMcpConfig(review.text, issued.token)
    if (!result.ok) {
      if (result.confirm?.length) {
        setReview({ text: review.text, launches: result.confirm })
      }
      toast.add({ type: "error", title: "Couldn't save", description: result.error })
      return
    }
    setText(review.text)
    toast.add({ type: "success", title: "MCP servers saved" })
    router.refresh()
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
          your approval. Drive uses this same Google account. Gmail stores one account,
          not a list of them.
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
                const result = await disconnectGoogleAccount()
                setPending(null)
                if (!result.ok) {
                  toast.add({
                    type: "error",
                    title: "Couldn't disconnect",
                    description: result.error,
                  })
                  return
                }
                if (result.revoked) {
                  toast.add({ type: "success", title: "Google disconnected" })
                } else {
                  toast.add({
                    type: "error",
                    title: "Disconnected on this computer",
                    description:
                      "Google still has the grant. Remove Xiryn from your Google account.",
                  })
                }
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

      <DriveCard
        connectors={connectors}
        pending={pending}
        result={driveResult}
        ok={driveOk}
        onPending={setPending}
        onResult={(ok, text) => {
          setDriveOk(ok)
          setDriveResult(text)
        }}
      />

      <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13.5px] font-medium">Other MCP servers</span>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            stdio and streamable HTTP. Saved to{" "}
            <span className="font-mono">{connectors.mcpPath}</span>, mode 600, not in git.
            Put secrets in the environment and refer to them as{" "}
            <span className="font-mono">{"${ENV:NAME}"}</span>. Write and send tools wait
            for approval unless a server sets <span className="font-mono">approval</span>{" "}
            to <span className="font-mono">none</span>. A new or changed stdio command
            runs on this computer and must be confirmed. Launchers:{" "}
            {DEFAULT_MCP_LAUNCHERS.join(", ")}.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono">
            Extra stdio programs · XIRYN_MCP_ALLOWED_COMMANDS
          </span>
          <input
            value={allowed}
            onChange={(event) => setAllowed(event.target.value)}
            placeholder="optional names, comma-separated — defaults stay allowed"
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 font-mono text-[12px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-mono">
            Grok Bot import hosts · XIRYN_GROKBOT_IMPORT_HOSTS
          </span>
          <textarea
            value={importHosts}
            onChange={(event) => setImportHosts(event.target.value)}
            placeholder="empty = any public https host"
            spellCheck={false}
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            Hostnames allowed when importing a Grok Bot from a share link. One per line. A
            listed host does not include its subdomains. Leave this empty to allow any
            public https host. Private and link-local addresses are never fetched. The
            preview shows the host before anything is saved.
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending === "allow"}
            onClick={saveAllowed}
          >
            {pending === "allow" && <Spinner data-icon="inline-start" />}
            Save extra programs
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending === "hosts"}
            onClick={saveImportHosts}
          >
            {pending === "hosts" && <Spinner data-icon="inline-start" />}
            Save import hosts
          </Button>
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
          <Button size="sm" disabled={pending === "mcp"} onClick={saveMcp}>
            {pending === "mcp" && <Spinner data-icon="inline-start" />}
            Save MCP servers
          </Button>
        </div>
        <Confirm
          open={review !== null}
          onOpenChange={(open) => {
            if (!open) setReview(null)
          }}
          title="Run this command on the host?"
          description={
            <div className="flex flex-col gap-3 text-left">
              <p>
                This starts a process on the computer running Xiryn, as the user Xiryn
                runs as. It is not inside an agent container. Confirm only the command and
                arguments shown here.
              </p>
              <ul className="flex flex-col gap-2">
                {(review?.launches ?? []).map((launch) => (
                  <li
                    key={launch.id}
                    className="rounded-lg border bg-muted/40 p-2 font-mono text-[11px] break-all"
                  >
                    <span className="label-mono">{launch.id}</span>
                    <div>command: {launch.command}</div>
                    <div>args: {JSON.stringify(launch.args)}</div>
                  </li>
                ))}
              </ul>
            </div>
          }
          action="Run on host"
          onConfirm={confirmMcp}
        />
      </div>
    </div>
  )
}

function DriveCard({
  connectors,
  pending,
  result,
  ok,
  onPending,
  onResult,
}: {
  connectors: SettingsData["connectors"]
  pending: string | null
  result: string | null
  ok: boolean
  onPending: (value: string | null) => void
  onResult: (ok: boolean, text: string) => void
}) {
  const router = useRouter()
  const driveOn = connectors.drive.value === "on"
  const readOnly = connectors.driveAccess.value !== "readwrite"
  const caps = driveCapabilities({
    enabled: driveOn,
    access: connectors.driveAccess.value,
    granted: connectors.driveGrant,
  })
  const grant = describeDriveGrant(connectors.driveGrant)
  const googleReady = connectors.clientId.set && connectors.clientSecret.set

  const save = async (key: string, value: string) => {
    onPending(key)
    try {
      await saveSettings({ [key]: value })
      router.refresh()
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't save",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      onPending(null)
    }
  }

  let status = "Drive tools are off. Gmail and Calendar are unchanged."
  if (driveOn && !connectors.connected) {
    status = "Drive is on. Connect Google to grant the scope. Read-only is the default."
  } else if (driveOn && !caps.read && grant === "unknown") {
    status =
      "Drive is on, but this connection has not granted a Drive scope yet. Reconnect Google after enabling the Drive API."
  } else if (driveOn && !caps.read) {
    status =
      "This Google account has not granted Drive. Add the scope on the consent screen, enable the Drive API, then reconnect."
  } else if (caps.write) {
    status =
      "Read-write. Creates, changes, copies and trash wait for approval. Sharing always waits."
  } else if (driveOn && !readOnly) {
    status =
      "Read-write is selected, but the full Drive scope is not granted. Reconnect Google before changes will run."
  } else if (caps.read) {
    status = "Read-only. Search and read run immediately. Writes and sharing are off."
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-medium">Google Drive</span>
        <span className="rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          {connectors.connected ? "google connected" : "not connected"}
        </span>
        <span className="rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          {readOnly ? "read-only" : "read-write"}
        </span>
      </div>
      <p className="max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
        Uses the Google OAuth client above, on the same one account as Gmail. In Google
        Cloud, enable the <span className="font-medium">Google Drive API</span> and add
        the scope to the consent screen. Read-only asks for{" "}
        <span className="font-mono">drive.readonly</span>. Read-write asks for the full{" "}
        <span className="font-mono">drive</span> scope, because{" "}
        <span className="font-mono">drive.file</span> cannot change files this app did not
        create. Reconnect after changing that. Trash is not a permanent delete. Sharing,
        including a public link, always waits for approval.
      </p>
      <p className="max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
        {status}
      </p>
      <label className="flex items-start gap-2.5">
        <Checkbox
          checked={driveOn}
          disabled={pending === "connectors.drive"}
          onCheckedChange={(checked) =>
            save("connectors.drive", checked === true ? "on" : "off")
          }
          className="mt-0.5"
        />
        <span className="text-[13px]">Drive tools</span>
      </label>
      <label className="flex items-start gap-2.5">
        <Checkbox
          checked={readOnly}
          disabled={pending === "connectors.drive.access"}
          onCheckedChange={(checked) =>
            save("connectors.drive.access", checked === true ? "readonly" : "readwrite")
          }
          className="mt-0.5"
        />
        <span className="text-[13px]">
          Read-only
          <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
            Default. Uncheck to allow create, rename, move, copy and trash. You will need
            to reconnect Google so it can ask for the full Drive scope.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {googleReady && (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href="/api/google/oauth/start" />}
          >
            {connectors.connected ? "Reconnect Google" : "Connect Google"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!connectors.connected || pending === "drive-test"}
          onClick={async () => {
            onPending("drive-test")
            try {
              const tested = await testDriveConnection()
              onResult(tested.ok, tested.ok ? tested.detail : tested.error)
            } catch (error) {
              onResult(false, error instanceof Error ? error.message : String(error))
            } finally {
              onPending(null)
            }
          }}
        >
          {pending === "drive-test" && <Spinner data-icon="inline-start" />}
          Test connection
        </Button>
        {driveOn && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={pending === "connectors.drive"}
            onClick={() => save("connectors.drive", "off")}
          >
            Disconnect Drive
          </Button>
        )}
      </div>
      {result && (
        <p className={ok ? "text-[12.5px] text-ok" : "text-[12.5px] text-destructive"}>
          {result}
        </p>
      )}
    </div>
  )
}
