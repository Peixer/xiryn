"use client"

import * as React from "react"
import { CheckIcon, ShieldCheckIcon, XIcon } from "lucide-react"

import { connectorAction, decideConnectorAction } from "@/actions/connectors"
import { useTakeover } from "@/components/thread/takeover"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type Action = NonNullable<Awaited<ReturnType<typeof connectorAction>>>

// A connector wants to send or change something. Nothing happens until the
// person approves this exact call.
export function ActionApprovalCard({
  approvalId,
  awaiting,
}: {
  approvalId: string
  awaiting: boolean
}) {
  const { send } = useTakeover()
  const [action, setAction] = React.useState<Action | null | undefined>(undefined)
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [allowDomain, setAllowDomain] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const [seenApproval, setSeenApproval] = React.useState(approvalId)
  if (seenApproval !== approvalId) {
    setSeenApproval(approvalId)
    setAllowDomain(false)
    setConfirmDiscard(false)
  }

  const load = React.useCallback(async () => {
    setAction(await connectorAction(approvalId))
  }, [approvalId])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (action === undefined) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-lg border bg-surface/50 p-3.5">
        <Spinner className="size-4" />
      </div>
    )
  }
  if (!action) return null

  const open = action.status === "pending" && awaiting

  const decide = async (choice: "approve" | "decline") => {
    setBusy(choice)
    setError(null)
    const result = await decideConnectorAction(approvalId, choice, {
      allowDomain: choice === "approve" && allowDomain,
      confirmDiscard: choice === "approve" && confirmDiscard,
    })
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
    send(result.text, result.marker)
  }

  return (
    <div
      className={cn(
        "my-1 flex flex-col gap-3 rounded-lg border p-3.5",
        action.status === "approved" || action.status === "used"
          ? "border-ok/25 bg-ok/5"
          : open
            ? "border-betelgeuse/30 bg-betelgeuse-soft"
            : "bg-surface/50"
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 font-mono text-[11px]",
          open ? "text-betelgeuse" : "text-muted-foreground"
        )}
      >
        <ShieldCheckIcon className="size-3.5" />
        {action.status === "approved" || action.status === "used"
          ? "approved"
          : action.status === "declined"
            ? "declined"
            : open
              ? "wants to do this · nothing happens until you choose"
              : "approval request"}
      </span>
      <pre
        dir="ltr"
        className="max-h-96 overflow-auto font-sans text-[13.5px] leading-relaxed break-words whitespace-pre-wrap [unicode-bidi:plaintext]"
      >
        {action.summary}
      </pre>
      <p className="font-mono text-[10.5px] text-muted-foreground">{action.tool}</p>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      {open && action.discardWarning && (
        <>
          {action.impact && (
            <p className="text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
              {action.impact}
            </p>
          )}
          <label className="flex items-start gap-2 text-[12.5px] leading-relaxed">
            <Checkbox
              checked={confirmDiscard}
              onCheckedChange={(checked) => setConfirmDiscard(checked === true)}
              className="mt-0.5"
            />
            <span>Discard data written since the switch</span>
          </label>
        </>
      )}
      {open && action.offerAllowDomain && action.host && (
        <label className="flex items-start gap-2 text-[12.5px] leading-relaxed">
          <Checkbox
            checked={allowDomain}
            onCheckedChange={(checked) => setAllowDomain(checked === true)}
            className="mt-0.5"
          />
          <span>
            Allow this domain from now on
            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
              {action.host}
            </span>
          </span>
        </label>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="min-h-11"
            disabled={!!busy || (action.discardWarning && !confirmDiscard)}
            onClick={() => decide("approve")}
          >
            {busy === "approve" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={!!busy}
            onClick={() => decide("decline")}
          >
            {busy === "decline" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <XIcon data-icon="inline-start" />
            )}
            Decline
          </Button>
        </div>
      )}
    </div>
  )
}
