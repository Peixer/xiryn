import { and, gte, isNotNull, sql } from "drizzle-orm"

import { db } from "@/db"
import { turns } from "@/db/schema"
import { getSetting, setSetting } from "@/lib/config"
import {
  findPrice,
  formatUsd,
  fromMicros,
  type CustomPrices,
  type Rate,
} from "@/lib/providers/pricing"

// Spending: prices the person set, and the monthly budget. Everything is
// worked out from the local ledger; nothing is fetched.

export function getCustomPrices(): CustomPrices {
  const raw = getSetting("pricing.custom")
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as CustomPrices
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

// Null removes the price, so the built-in one (if any) applies again
export function setCustomPrice(spec: string, rate: Rate | null) {
  const prices = getCustomPrices()
  if (rate) prices[spec] = rate
  else delete prices[spec]
  setSetting(
    "pricing.custom",
    Object.keys(prices).length > 0 ? JSON.stringify(prices) : null
  )
}

export function getMonthlyBudget() {
  const value = Number.parseFloat(getSetting("usage.monthlyBudget") ?? "")
  return Number.isFinite(value) && value > 0 ? value : null
}

export function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

// Dollars spent on priced turns since the first of this month
export function monthSpend(now = new Date()) {
  const row = db
    .select({ micros: sql<number>`coalesce(sum(${turns.costMicros}), 0)` })
    .from(turns)
    .where(and(gte(turns.createdAt, startOfMonth(now)), isNotNull(turns.costMicros)))
    .get()
  return fromMicros(row?.micros ?? 0)
}

// A reason to hold the turn, or null to let it run. Local models always
// run; so do models without a known price, which the budget can't count.
export function budgetBlock(spec: string) {
  const budget = getMonthlyBudget()
  if (!budget) return null
  const price = findPrice(spec, { custom: getCustomPrices() })
  if (!price || price.kind === "local") return null
  const spent = monthSpend()
  if (spent < budget) return null
  return `This month's budget of ${formatUsd(budget)} is used up (${formatUsd(spent)} spent). Raise it in Settings → Usage, or switch this agent to a local model, which is free.`
}
