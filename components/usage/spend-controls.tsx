"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PencilIcon } from "lucide-react"

import { clearModelPrice, setModelPrice, setMonthlyBudget } from "@/actions/usage"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { formatUsd } from "@/lib/providers/pricing"
import { cn } from "@/lib/utils"

const field =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 font-mono text-[12px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"

function useAction() {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const run = async (action: () => Promise<unknown>, done: string) => {
    setPending(true)
    try {
      await action()
      toast.add({ type: "success", title: done })
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
  return { run, pending }
}

// This month's spend against an optional budget, which pauses paid models
// once it's reached
export function BudgetCard({ spent, budget }: { spent: number; budget: number | null }) {
  const { run, pending } = useAction()
  const [value, setValue] = React.useState(budget ? String(budget) : "")
  const share = budget ? Math.min(1, spent / budget) : 0

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-surface/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label-mono">this month</span>
        <span className="font-mono text-[12px] tabular-nums">
          {formatUsd(spent)}
          {budget && (
            <span className="text-muted-foreground"> of {formatUsd(budget)}</span>
          )}
        </span>
      </div>
      {budget && (
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              share >= 1 ? "bg-destructive" : share >= 0.8 ? "bg-warn" : "bg-rigel"
            )}
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void run(
            () => setMonthlyBudget(value),
            Number.parseFloat(value) > 0 ? "Budget saved" : "Budget removed"
          )
        }}
      >
        <label className="flex min-w-40 flex-1 flex-col gap-1.5">
          <span className="text-[12px] text-muted-foreground">
            Monthly budget, in US dollars
          </span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="no limit"
            className={field}
          />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </form>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Once it&apos;s reached, agents on paid models wait until the 1st. Local models
        keep working, since they cost nothing.
      </p>
    </div>
  )
}

// Sets the price of a model Xiryn doesn't know, or overrides one it does
export function PriceButton({
  spec,
  hasCustom,
  unknown,
}: {
  spec: string
  hasCustom: boolean
  unknown: boolean
}) {
  const { run, pending } = useAction()
  const [open, setOpen] = React.useState(false)
  const [input, setInput] = React.useState("")
  const [output, setOutput] = React.useState("")

  const save = async () => {
    const ok = await run(
      () =>
        setModelPrice({
          spec,
          input: Number.parseFloat(input),
          output: Number.parseFloat(output),
        }),
      `Price saved for ${spec}`
    )
    if (ok) setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-sm font-mono text-[10.5px] transition-colors",
          unknown ? "text-rigel hover:underline" : "text-faint hover:text-foreground"
        )}
        aria-label={`Set the price of ${spec}`}
      >
        {unknown ? "set price" : <PencilIcon className="size-3" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-[12px] font-medium">{spec}</span>
          <span className="text-[11.5px] text-muted-foreground">
            US dollars per million tokens, from your provider&apos;s pricing page.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label-mono">input</span>
            <input
              inputMode="decimal"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="0.50"
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">output</span>
            <input
              inputMode="decimal"
              value={output}
              onChange={(event) => setOutput(event.target.value)}
              placeholder="2.00"
              className={field}
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending || !input || !output} onClick={save}>
            {pending && <Spinner data-icon="inline-start" />}
            Save
          </Button>
          {hasCustom && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                if (await run(() => clearModelPrice(spec), "Price removed"))
                  setOpen(false)
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
