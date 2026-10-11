import type { Metadata } from "next"
import Link from "next/link"
import { format, formatDistanceToNowStrict, subDays } from "date-fns"

import { Glyph } from "@/components/glyph"
import { cn } from "@/lib/utils"
import { getUsage } from "@/queries/workspace"

export const metadata: Metadata = { title: "Usage" }

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface/60 px-4 py-3.5">
      <span className="label-mono">{label}</span>
      <span className="font-mono text-2xl font-medium tracking-tight tabular-nums">
        {value}
      </span>
      {hint && <span className="font-mono text-[10.5px] text-faint">{hint}</span>}
    </div>
  )
}

export default function Page() {
  const usage = getUsage(30)
  const { totals } = usage

  // Fill every day of the window so quiet days show as gaps
  const byDay = new Map(usage.daily.map((d) => [d.day, d]))
  const days = Array.from({ length: usage.days }, (_, i) => {
    const date = subDays(new Date(), usage.days - 1 - i)
    const key = format(date, "yyyy-MM-dd")
    return {
      key,
      date,
      tokens: byDay.get(key)?.tokens ?? 0,
      turns: byDay.get(key)?.turns ?? 0,
    }
  })
  const peak = Math.max(1, ...days.map((d) => d.tokens))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="label-mono">{`// ledger · last ${usage.days} days`}</span>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Every agent turn is recorded locally: the model it ran on and the tokens it
            consumed. Your providers bill you directly — Xiryn just keeps the receipts.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
          <Stat
            label="turns"
            value={compact.format(totals.turns)}
            hint={totals.failed ? `${totals.failed} failed` : "all clean"}
          />
          <Stat
            label="input tokens"
            value={compact.format(totals.input)}
            hint={totals.cached ? `${compact.format(totals.cached)} cached` : undefined}
          />
          <Stat
            label="output tokens"
            value={compact.format(totals.output)}
            hint={
              totals.reasoning
                ? `${compact.format(totals.reasoning)} reasoning`
                : undefined
            }
          />
          <Stat
            label="tool calls"
            value={compact.format(totals.toolCalls)}
            hint={
              totals.turns
                ? `${(totals.durationMs / totals.turns / 1000).toFixed(1)}s avg turn`
                : undefined
            }
          />
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="label-mono">tokens per day</h2>
          <div className="rounded-xl border bg-surface/50 p-4">
            <div className="flex h-40 items-end gap-[3px]">
              {days.map((day) => (
                <div
                  key={day.key}
                  className="group relative flex h-full flex-1 items-end"
                >
                  <div
                    className={cn(
                      "w-full rounded-t-[2px] transition-colors",
                      day.tokens ? "bg-rigel/70 group-hover:bg-rigel" : "bg-border"
                    )}
                    style={{
                      height: day.tokens
                        ? `${Math.max(3, (day.tokens / peak) * 100)}%`
                        : "2px",
                    }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 font-mono text-[10.5px] whitespace-nowrap shadow-md group-hover:block">
                    {format(day.date, "MMM d")} · {compact.format(day.tokens)} tokens ·{" "}
                    {day.turns} turns
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
              <span>{format(days[0].date, "MMM d")}</span>
              <span>today</span>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h2 className="label-mono">by model</h2>
            <div className="divide-y rounded-xl border bg-surface/50 font-mono text-[12px]">
              {usage.byModel.length === 0 && (
                <p className="px-4 py-3 text-muted-foreground">No turns yet.</p>
              )}
              {usage.byModel.map((row) => (
                <div key={row.model} className="flex items-baseline gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{row.model}</span>
                  <span className="text-muted-foreground">{row.turns} turns</span>
                  <span className="w-28 text-right tabular-nums">
                    {compact.format(row.input)} / {compact.format(row.output)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="label-mono">by agent</h2>
            <div className="divide-y rounded-xl border bg-surface/50 text-[12px]">
              {usage.byAgent.length === 0 && (
                <p className="px-4 py-3 font-mono text-muted-foreground">No turns yet.</p>
              )}
              {usage.byAgent.map((row) => (
                <div key={row.agentId} className="flex items-center gap-3 px-4 py-2">
                  {row.glyph && <Glyph seed={row.glyph} className="size-5" />}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {row.name ?? "deleted agent"}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {row.toolCalls} tools
                  </span>
                  <span className="w-28 text-right font-mono tabular-nums">
                    {compact.format(row.input)} / {compact.format(row.output)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="label-mono">recent turns</h2>
          <div className="overflow-x-auto rounded-xl border bg-surface/50">
            <table className="w-full font-mono text-[11.5px]">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {["when", "agent", "model", "status", "in", "out", "steps", "time"].map(
                    (h) => (
                      <th key={h} className="px-3 py-2 font-normal">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {usage.recent.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-muted-foreground">
                      Nothing yet. Talk to an agent and its turns land here.
                    </td>
                  </tr>
                )}
                {usage.recent.map((turn) => (
                  <tr
                    key={turn.id}
                    className="hover:bg-accent/30"
                    title={turn.error ?? undefined}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNowStrict(turn.createdAt, { addSuffix: true })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        {turn.agentGlyph && (
                          <Glyph
                            seed={turn.agentGlyph}
                            className="size-4 rounded-[3px]"
                          />
                        )}
                        {turn.agentName ?? "—"}
                      </span>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2">{turn.model}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          turn.status === "completed"
                            ? "text-ok"
                            : turn.status === "failed"
                              ? "text-destructive"
                              : "text-warn"
                        )}
                      >
                        {turn.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {compact.format(turn.input)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {compact.format(turn.output)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{turn.steps}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {(turn.durationMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[10.5px] text-faint">
            Costs aren&apos;t estimated — prices change. Check your provider&apos;s
            dashboard for spend.{" "}
            <Link href="/settings#providers" className="hover:text-foreground">
              providers →
            </Link>
          </p>
        </section>
      </div>
    </div>
  )
}
