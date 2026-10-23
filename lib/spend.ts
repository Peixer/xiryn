import { and, eq, gte, isNotNull, sql } from "drizzle-orm"

import { db } from "@/db"
import { agents, turns } from "@/db/schema"
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

export type AgentBudgets = Record<string, number>

function knownAgentIds() {
  return new Set(
    db
      .select({ id: agents.id })
      .from(agents)
      .all()
      .map((agent) => agent.id)
  )
}

// Positive USD amounts keyed by an agent that still exists. Anything else in
// the stored JSON (unknown ids, zero, junk) is ignored.
export function getAgentBudgets(): AgentBudgets {
  const raw = getSetting("usage.agentBudgets")
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const known = knownAgentIds()
  const budgets: AgentBudgets = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (!known.has(id)) continue
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue
    budgets[id] = value
  }
  return budgets
}

// Zero, negative, or null clears the limit. An id that isn't an agent is ignored.
export function setAgentBudget(agentId: string, usd: number | null) {
  if (!knownAgentIds().has(agentId)) return
  const budgets = getAgentBudgets()
  if (usd !== null && Number.isFinite(usd) && usd > 0) budgets[agentId] = usd
  else delete budgets[agentId]
  setSetting(
    "usage.agentBudgets",
    Object.keys(budgets).length > 0 ? JSON.stringify(budgets) : null
  )
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

// This agent's priced turns only, so a hand-off recorded under the delegate
// counts against the delegate and not whoever started the thread.
export function agentMonthSpend(agentId: string, now = new Date()) {
  const row = db
    .select({ micros: sql<number>`coalesce(sum(${turns.costMicros}), 0)` })
    .from(turns)
    .where(
      and(
        eq(turns.agentId, agentId),
        gte(turns.createdAt, startOfMonth(now)),
        isNotNull(turns.costMicros)
      )
    )
    .get()
  return fromMicros(row?.micros ?? 0)
}

function agentLimitMessage(agentId: string, limit: number, spent: number) {
  const name = db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()?.name
  const who = name ? `${name}'s` : "This agent's"
  return `${who} monthly limit of ${formatUsd(limit)} is used up (${formatUsd(spent)} spent). Raise it on the Usage page, or switch this agent to a local model, which is free.`
}

// A reason to hold the turn, or null to let it run. Local models always
// run; so do models without a known price, which the budget can't count.
// An agent's own limit is checked first, then the global monthly budget.
export function budgetBlock(spec: string, agentId?: string) {
  const limit = agentId ? getAgentBudgets()[agentId] : undefined
  const budget = getMonthlyBudget()
  if (!limit && !budget) return null
  const price = findPrice(spec, { custom: getCustomPrices() })
  if (!price || price.kind === "local") return null
  if (limit && agentId) {
    const spent = agentMonthSpend(agentId)
    if (spent >= limit) return agentLimitMessage(agentId, limit, spent)
  }
  if (!budget) return null
  const spent = monthSpend()
  if (spent < budget) return null
  return `This month's budget of ${formatUsd(budget)} is used up (${formatUsd(spent)} spent). Raise it in Settings → Usage, or switch this agent to a local model, which is free.`
}
