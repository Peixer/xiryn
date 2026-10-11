"use client"

import * as React from "react"
import { LockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { VaultKind } from "@/lib/vault"
import { cn } from "@/lib/utils"

// One form for everything the vault holds. Values go from here to the
// server, are encrypted there and never come back to the browser.

type FieldSpec = {
  name: string
  label: string
  placeholder?: string
  secret?: boolean
  numeric?: boolean
  optional?: boolean
  wide?: boolean
  autoComplete?: string
}

export const VAULT_FORMS: Record<VaultKind, { title: string; fields: FieldSpec[] }> = {
  card: {
    title: "Card",
    fields: [
      {
        name: "number",
        label: "Card number",
        placeholder: "1234 5678 9012 3456",
        numeric: true,
        wide: true,
        autoComplete: "cc-number",
      },
      { name: "expiry", label: "Expiry", placeholder: "MM/YY", autoComplete: "cc-exp" },
      {
        name: "cvv",
        label: "Security code",
        placeholder: "CVV",
        secret: true,
        numeric: true,
        optional: true,
        autoComplete: "cc-csc",
      },
      {
        name: "name",
        label: "Name on card",
        optional: true,
        wide: true,
        autoComplete: "cc-name",
      },
    ],
  },
  upi: {
    title: "UPI ID",
    fields: [{ name: "id", label: "UPI ID", placeholder: "name@bank", wide: true }],
  },
  login: {
    title: "Login",
    fields: [
      { name: "site", label: "Site", placeholder: "swiggy.com", wide: true },
      {
        name: "username",
        label: "Email, phone or username",
        wide: true,
        autoComplete: "username",
      },
      {
        name: "password",
        label: "Password",
        secret: true,
        wide: true,
        autoComplete: "current-password",
      },
    ],
  },
  identity: {
    title: "Personal details",
    fields: [
      {
        name: "name",
        label: "Full name",
        optional: true,
        wide: true,
        autoComplete: "name",
      },
      { name: "email", label: "Email", optional: true, autoComplete: "email" },
      { name: "phone", label: "Phone", optional: true, autoComplete: "tel" },
      {
        name: "address_line1",
        label: "Address",
        optional: true,
        wide: true,
        autoComplete: "address-line1",
      },
      {
        name: "address_line2",
        label: "Address line 2",
        optional: true,
        wide: true,
        autoComplete: "address-line2",
      },
      { name: "city", label: "City", optional: true, autoComplete: "address-level2" },
      { name: "state", label: "State", optional: true, autoComplete: "address-level1" },
      {
        name: "postcode",
        label: "PIN / postcode",
        optional: true,
        autoComplete: "postal-code",
      },
      { name: "country", label: "Country", optional: true, autoComplete: "country-name" },
    ],
  },
  code: {
    title: "One-time code",
    fields: [
      {
        name: "code",
        label: "Code",
        placeholder: "123456",
        numeric: true,
        wide: true,
        autoComplete: "one-time-code",
      },
    ],
  },
}

export function VaultForm({
  kind,
  defaults = {},
  saveOption = false,
  label: withLabel = true,
  submitLabel = "Save to vault",
  onSubmit,
  onCancel,
  compact = false,
}: {
  kind: VaultKind
  defaults?: Record<string, string>
  // Offer "save for next time" (otherwise it's kept for this task only)
  saveOption?: boolean
  label?: boolean
  submitLabel?: string
  onSubmit: (
    data: Record<string, string>,
    options: { save: boolean; label?: string }
  ) => Promise<string | null>
  onCancel?: () => void
  compact?: boolean
}) {
  const spec = VAULT_FORMS[kind]
  const [values, setValues] = React.useState<Record<string, string>>(() => ({
    ...defaults,
  }))
  const [label, setLabel] = React.useState("")
  const [save, setSave] = React.useState(kind !== "code")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  return (
    <form
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(null)
        const problem = await onSubmit(values, {
          save: saveOption ? save : true,
          label: label.trim() || undefined,
        })
        setBusy(false)
        if (problem) setError(problem)
        // Nothing typed stays in the page once it's in the vault
        else setValues({ ...defaults })
      }}
      className="flex flex-col gap-3"
    >
      <div className={cn("grid gap-2.5", !compact && "sm:grid-cols-2")}>
        {spec.fields.map((field) => (
          <label
            key={field.name}
            className={cn(
              "flex flex-col gap-1",
              field.wide && !compact && "sm:col-span-2"
            )}
          >
            <span className="label-mono">
              {field.label}
              {field.optional && (
                <span className="ml-1 text-faint normal-case">optional</span>
              )}
            </span>
            <Input
              type={field.secret ? "password" : "text"}
              inputMode={field.numeric ? "numeric" : undefined}
              autoComplete={field.autoComplete ?? "off"}
              spellCheck={false}
              value={values[field.name] ?? ""}
              placeholder={field.placeholder}
              required={!field.optional && kind !== "identity"}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }
              className="font-mono"
            />
          </label>
        ))}
        {withLabel && kind !== "code" && (
          <label className={cn("flex flex-col gap-1", !compact && "sm:col-span-2")}>
            <span className="label-mono">
              Label<span className="ml-1 text-faint normal-case">optional</span>
            </span>
            <Input
              value={label}
              placeholder={kind === "card" ? "e.g. HDFC credit card" : "e.g. Personal"}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
        )}
      </div>

      {saveOption && kind !== "code" && (
        <label className="flex items-center gap-2 text-[12.5px]">
          <Checkbox checked={save} onCheckedChange={(checked) => setSave(checked)} />
          Save to my vault for next time
        </label>
      )}

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <LockIcon data-icon="inline-start" />
          )}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-faint">
          <LockIcon className="size-3" />
          encrypted on this computer · agents see a masked hint only
        </span>
      </div>
    </form>
  )
}
