"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PlugIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"

import { fetchProviderModels, saveSettings, testIntegration } from "@/actions/settings"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useWorkspace } from "@/components/workspace/context"
import type { SettingView } from "@/lib/config"
import { cn } from "@/lib/utils"
import type { SettingsData } from "@/queries/workspace"

/* ───────────────────────────── bits ────────────────────────────── */

function SourceBadge({
  setting,
  unset = "unset",
}: {
  setting: SettingView
  unset?: string
}) {
  if (!setting.source)
    return <span className="font-mono text-[10px] text-faint">{unset}</span>
  const tone =
    setting.source === "local"
      ? "border-rigel/30 text-rigel"
      : setting.source === "env"
        ? "border-ok/30 text-ok"
        : "text-faint"
  const label =
    setting.source === "local"
      ? "saved here"
      : setting.source === "env"
        ? ".env"
        : "default"
  return (
    <span
      title={setting.env ? `Environment variable: ${setting.env}` : undefined}
      className={cn("rounded-sm border px-1.5 py-px font-mono text-[10px]", tone)}
    >
      {label}
    </span>
  )
}

function Section({
  id,
  kicker,
  title,
  description,
  children,
}: {
  id: string
  kicker: string
  title: string
  description: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="label-mono">{kicker}</span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

function SecretInput({
  setting,
  value,
  onChange,
  placeholder,
}: {
  setting: SettingView
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <KeyRoundIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          setting.value
            ? `${setting.value}  (leave empty to keep)`
            : (placeholder ?? "Paste key")
        }
        className="h-8 w-full rounded-lg border border-input bg-transparent pr-2.5 pl-8 font-mono text-[12px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
      />
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-[12px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30",
        mono && "font-mono"
      )}
    />
  )
}

function useSave() {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const save = async (values: Record<string, string | null>, message = "Saved") => {
    setPending(true)
    try {
      await saveSettings(values)
      toast.add({ type: "success", title: message })
      router.refresh()
      return true
    } catch (error) {
      toast.add({
        type: "error",
        title: "Couldn't save",
        description: error instanceof Error ? error.message : String(error),
      })
      return false
    } finally {
      setPending(false)
    }
  }
  return { save, pending }
}

type TestResult = { ok: true; detail: string } | { ok: false; error: string } | null

function TestLine({ result }: { result: TestResult }) {
  if (!result) return null
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 font-mono text-[11px]",
        result.ok ? "text-ok" : "text-destructive"
      )}
    >
      {result.ok ? (
        <CheckIcon className="mt-px size-3.5 shrink-0" />
      ) : (
        <XIcon className="mt-px size-3.5 shrink-0" />
      )}
      <span className="break-all">{result.ok ? result.detail : result.error}</span>
    </p>
  )
}

/* ─────────────────────────── providers ─────────────────────────── */

function ProviderRow({ provider }: { provider: SettingsData["providers"][number] }) {
  const { save, pending } = useSave()
  const [key, setKey] = React.useState("")
  const [baseUrl, setBaseUrl] = React.useState(
    provider.baseUrl.source === "local" ? (provider.baseUrl.value ?? "") : ""
  )
  const [testing, setTesting] = React.useState(false)
  const [result, setResult] = React.useState<TestResult>(null)
  const configured = provider.local
    ? provider.baseUrl.source === "local" || provider.baseUrl.source === "env"
    : provider.requiresBaseUrl
      ? provider.baseUrl.set
      : provider.apiKey.set
  const showsKey = provider.keyEnv !== null

  const test = async () => {
    setTesting(true)
    const response = await fetchProviderModels(provider.id)
    setResult(
      response.ok
        ? { ok: true, detail: `${response.models.length} models available` }
        : { ok: false, error: response.error }
    )
    setTesting(false)
  }

  return (
    <Collapsible className="group/provider">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30">
        <span
          className={cn("size-1.5 rounded-full", configured ? "bg-ok" : "bg-faint/50")}
        />
        <span className="text-[13.5px] font-medium">{provider.name}</span>
        {provider.local && (
          <span className="rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
            local
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {showsKey && provider.apiKey.set && (
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
              {provider.apiKey.value}
            </span>
          )}
          {showsKey ? (
            <SourceBadge setting={provider.apiKey} />
          ) : (
            <SourceBadge setting={provider.baseUrl} />
          )}
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-open/provider:rotate-90" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t bg-background/40 px-4 py-4">
          {showsKey && (
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between">
                <span className="label-mono">API key</span>
                <span className="font-mono text-[10px] text-faint">
                  {provider.keyEnv}
                </span>
              </span>
              <SecretInput setting={provider.apiKey} value={key} onChange={setKey} />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between">
              <span className="label-mono">
                Endpoint{provider.requiresBaseUrl || provider.local ? "" : " (optional)"}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {provider.baseUrlEnv}
              </span>
            </span>
            <TextInput
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder={
                provider.baseUrl.source === "env"
                  ? `${provider.baseUrl.value} (from .env)`
                  : provider.defaultBaseUrl || "https://your-endpoint/v1"
              }
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={
                pending ||
                (!key.trim() &&
                  baseUrl ===
                    (provider.baseUrl.source === "local" ? provider.baseUrl.value : ""))
              }
              onClick={async () => {
                const values: Record<string, string | null> = {
                  [`provider.${provider.id}.baseUrl`]: baseUrl.trim() || null,
                }
                if (key.trim()) values[`provider.${provider.id}.apiKey`] = key.trim()
                if (await save(values, `${provider.name} saved`)) setKey("")
              }}
            >
              {pending && <Spinner data-icon="inline-start" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testing || !configured}
              onClick={test}
            >
              {testing ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlugIcon data-icon="inline-start" />
              )}
              Test connection
            </Button>
            {provider.apiKey.source === "local" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() =>
                  save({ [`provider.${provider.id}.apiKey`]: null }, "Saved key removed")
                }
              >
                <RotateCcwIcon data-icon="inline-start" />
                Forget saved key
              </Button>
            )}
            {provider.keysUrl && (
              <a
                href={provider.keysUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                get a key <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </div>
          <TestLine result={result} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ────────────────────────── integrations ───────────────────────── */

function IntegrationCard({
  name,
  kind,
  description,
  href,
  fields,
}: {
  name: string
  kind: "daytona" | "firecrawl"
  description: string
  href: string
  fields: {
    key: string
    label: string
    setting: SettingView
    secret?: boolean
    placeholder?: string
  }[]
}) {
  const { save, pending } = useSave()
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        !field.secret && field.setting.source === "local"
          ? (field.setting.value ?? "")
          : "",
      ])
    )
  )
  const [testing, setTesting] = React.useState(false)
  const [result, setResult] = React.useState<TestResult>(null)
  const keyField = fields.find((field) => field.secret)!
  const connected = keyField.setting.set

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-surface/50 p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            connected ? "bg-ok" : "bg-faint/50"
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{name}</span>
            <SourceBadge setting={keyField.setting} />
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          get a key <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label
            key={field.key}
            className={cn("flex flex-col gap-1.5", field.secret && "sm:col-span-2")}
          >
            <span className="flex items-center justify-between">
              <span className="label-mono">{field.label}</span>
              <span className="font-mono text-[10px] text-faint">
                {field.setting.env}
              </span>
            </span>
            {field.secret ? (
              <SecretInput
                setting={field.setting}
                value={values[field.key]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [field.key]: value }))
                }
              />
            ) : (
              <TextInput
                value={values[field.key]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [field.key]: value }))
                }
                placeholder={
                  field.setting.value ? `${field.setting.value}` : field.placeholder
                }
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={async () => {
            const payload: Record<string, string | null> = {}
            for (const field of fields) {
              const value = values[field.key].trim()
              if (field.secret) {
                if (value) payload[field.key] = value
              } else {
                payload[field.key] = value || null
              }
            }
            if (await save(payload, `${name} saved`)) {
              setValues((current) => ({ ...current, [keyField.key]: "" }))
            }
          }}
        >
          {pending && <Spinner data-icon="inline-start" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={testing || !connected}
          onClick={async () => {
            setTesting(true)
            setResult(await testIntegration(kind))
            setTesting(false)
          }}
        >
          {testing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PlugIcon data-icon="inline-start" />
          )}
          Test connection
        </Button>
        {keyField.setting.source === "local" && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => save({ [keyField.key]: null }, "Saved key removed")}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Forget saved key
          </Button>
        )}
      </div>
      <TestLine result={result} />
    </div>
  )
}

/* ──────────────────────────── model ────────────────────────────── */

function ModelSection({ data }: { data: SettingsData }) {
  const { status } = useWorkspace()
  const { save, pending } = useSave()
  const [model, setModel] = React.useState(
    data.defaultModel.source === "local" ? (data.defaultModel.value ?? "") : ""
  )
  const [steps, setSteps] = React.useState(
    data.maxSteps.source === "local" ? (data.maxSteps.value ?? "") : ""
  )

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-surface/50 p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between">
            <span className="label-mono">Default model</span>
            <SourceBadge setting={data.defaultModel} unset="auto" />
          </span>
          <ModelPicker
            value={model}
            onChange={setModel}
            providers={status.providerOptions}
            allowDefault={data.defaultModel.source === "env" || !data.defaultModel.set}
            defaultSpec={
              data.defaultModel.source === "env"
                ? data.defaultModel.value
                : data.resolvedDefaultModel
            }
          />
          <span className="text-[11.5px] text-muted-foreground">
            Used by every agent that doesn&apos;t pick its own.
            {data.defaultModel.source === "env" &&
              " Currently set by ORYN_DEFAULT_MODEL in .env."}
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between">
            <span className="label-mono">Max steps</span>
            <SourceBadge setting={data.maxSteps} />
          </span>
          <TextInput
            value={steps}
            onChange={setSteps}
            placeholder={data.maxSteps.value ?? "40"}
          />
          <span className="text-[11.5px] text-muted-foreground">
            Per turn, before it stops.
          </span>
        </label>
      </div>
      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            save({ "model.default": model || null, "agent.maxSteps": steps || null })
          }
        >
          {pending && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </div>
    </div>
  )
}

/* ──────────────────────────── page ─────────────────────────────── */

export function SettingsForm({
  data,
  telegram,
}: {
  data: SettingsData
  telegram: React.ReactNode
}) {
  const nav = [
    ["model", "Model"],
    ["providers", "Providers"],
    ["integrations", "Integrations"],
    ["remote", "Remote access"],
    ["system", "System"],
  ]

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[180px_1fr]">
      <nav className="hidden flex-col gap-0.5 lg:sticky lg:top-12 lg:flex lg:self-start">
        <span className="label-mono mb-2 px-2">{"// settings"}</span>
        {nav.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Keys can live in{" "}
            <code className="rounded-sm bg-muted px-1 font-mono text-[12px]">.env</code>{" "}
            or be saved here. Values saved here take precedence and are stored only in
            your local database — the browser only ever sees masked versions.
          </p>
        </header>

        <Section
          id="model"
          kicker="01 · model"
          title="Default model"
          description="Agents think with this model unless they're configured with their own. Any provider/model pair works, including local models."
        >
          <ModelSection data={data} />
        </Section>

        <Section
          id="providers"
          kicker="02 · providers"
          title="Model providers"
          description="Bring your own keys. Configure as many providers as you like and mix them across agents. Local runtimes (Ollama, LM Studio) need only an endpoint."
        >
          <div className="divide-y overflow-hidden rounded-xl border bg-surface/50">
            {data.providers.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} />
            ))}
          </div>
        </Section>

        <Section
          id="integrations"
          kicker="03 · integrations"
          title="Workstations & web"
          description="Both are optional. Without Daytona agents can't run code or use a desktop; without Firecrawl they can't search or read the web."
        >
          <IntegrationCard
            name="Daytona"
            kind="daytona"
            href="https://app.daytona.io/dashboard/keys"
            description="One Linux sandbox per agent — shell, filesystem and a graphical desktop — in your own Daytona account, never on your machine. Keep it, or make it disposable with auto-delete."
            fields={[
              {
                key: "daytona.apiKey",
                label: "API key",
                setting: data.daytona.apiKey,
                secret: true,
              },
              { key: "daytona.apiUrl", label: "API URL", setting: data.daytona.apiUrl },
              {
                key: "daytona.target",
                label: "Region",
                setting: data.daytona.target,
                placeholder: "us / eu (account default)",
              },
              {
                key: "daytona.autoStop",
                label: "Auto-stop (minutes)",
                setting: data.daytona.autoStop,
              },
              {
                key: "daytona.autoDelete",
                label: "Auto-delete after stop (minutes)",
                setting: data.daytona.autoDelete,
                placeholder: "never — keep files",
              },
            ]}
          />
          <IntegrationCard
            name="Firecrawl"
            kind="firecrawl"
            href="https://www.firecrawl.dev/app/api-keys"
            description="Web search and clean page extraction for every agent."
            fields={[
              {
                key: "firecrawl.apiKey",
                label: "API key",
                setting: data.firecrawl.apiKey,
                secret: true,
              },
              {
                key: "firecrawl.apiUrl",
                label: "API URL",
                setting: data.firecrawl.apiUrl,
              },
            ]}
          />
        </Section>

        <Section
          id="remote"
          kicker="04 · remote access"
          title="Telegram"
          description="Talk to your agents from anywhere. Oryn polls Telegram from this machine — no public URL, no port forwarding, no tunnel."
        >
          {telegram}
        </Section>

        <Section
          id="system"
          kicker="05 · system"
          title="System"
          description="Where your data lives and what Oryn is running on."
        >
          <div className="divide-y rounded-xl border bg-surface/50 font-mono text-[12px]">
            {[
              ["database", data.dbPath],
              ["agents", data.counts.agents],
              ["squads", data.counts.squads],
              ["threads", data.counts.threads],
              ["messages", data.counts.messages],
              ["memories", data.counts.memories],
              ["allowed hosts", data.allowedHosts ?? "localhost only"],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="flex items-baseline justify-between gap-4 px-4 py-2"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="min-w-0 truncate text-right">{String(value)}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
