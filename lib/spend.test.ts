import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, beforeEach, test } from "node:test"

import { toMicros } from "@/lib/providers/pricing"

// A throwaway database: the real schema and migrations, nothing of the user's.
process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-spend-"))

const { db, sqlite } = await import("@/db")
const { agents, turns } = await import("@/db/schema")
const { getSetting, setSetting } = await import("@/lib/config")
const { agentMonthSpend, budgetBlock, getAgentBudgets, setAgentBudget } =
  await import("./spend")

const PAID = "openai/gpt-6-luna"
const LOCAL = "ollama/qwen3.5:9b"
const UNPRICED = "custom/not-in-the-catalog"

after(() => {
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

beforeEach(() => {
  sqlite.exec("delete from turns; delete from agents; delete from settings;")
})

function makeAgent(name: string) {
  const [agent] = db.insert(agents).values({ name, role: "tester" }).returning().all()
  return agent
}

function recordSpend(agentId: string, usd: number, createdAt = new Date()) {
  db.insert(turns)
    .values({
      agentId,
      model: PAID,
      costMicros: toMicros(usd),
      status: "completed",
      createdAt,
    })
    .run()
}

test("blocks a paid turn when the agent's month spend reaches its limit", () => {
  const research = makeAgent("Research")
  const writer = makeAgent("Writer")
  setAgentBudget(research.id, 0.01)
  recordSpend(research.id, 0.02)

  const blocked = budgetBlock(PAID, research.id)
  assert.equal(typeof blocked, "string")
  assert.match(blocked!, /Research/)
  assert.match(blocked!, /\$0\.01/)
  assert.match(blocked!, /\$0\.02/)
  assert.match(blocked!, /limit/i)

  assert.equal(budgetBlock(PAID, writer.id), null)
  assert.equal(agentMonthSpend(research.id), 0.02)
  assert.equal(agentMonthSpend(writer.id), 0)
})

test("allows a paid turn when the agent is under its limit", () => {
  const research = makeAgent("Research")
  setAgentBudget(research.id, 1)
  recordSpend(research.id, 0.5)

  assert.equal(budgetBlock(PAID, research.id), null)
  assert.equal(agentMonthSpend(research.id), 0.5)
})

test("ignores unknown agent ids", () => {
  const research = makeAgent("Research")
  setAgentBudget("does-not-exist", 0.01)
  setAgentBudget(research.id, 0.5)
  setSetting(
    "usage.agentBudgets",
    JSON.stringify({ "does-not-exist": 0.01, [research.id]: 0.5, "": 3, bad: "nope" })
  )

  assert.deepEqual(getAgentBudgets(), { [research.id]: 0.5 })
  assert.equal(budgetBlock(PAID, "does-not-exist"), null)
  assert.equal(agentMonthSpend("does-not-exist"), 0)
  recordSpend(research.id, 1)
  assert.match(budgetBlock(PAID, research.id)!, /Research/)

  setSetting("usage.agentBudgets", "{")
  assert.deepEqual(getAgentBudgets(), {})
  assert.equal(budgetBlock(PAID, research.id), null)
})

test("round-trips agent budgets as JSON", () => {
  const research = makeAgent("Research")
  const writer = makeAgent("Writer")
  setAgentBudget(research.id, 0.01)
  setAgentBudget(writer.id, 12.5)

  assert.deepEqual(getAgentBudgets(), { [research.id]: 0.01, [writer.id]: 12.5 })
  assert.deepEqual(JSON.parse(getSetting("usage.agentBudgets")!), {
    [research.id]: 0.01,
    [writer.id]: 12.5,
  })
})

test("zero or negative removes the limit", () => {
  const research = makeAgent("Research")
  setAgentBudget(research.id, 0.01)
  recordSpend(research.id, 1)

  setAgentBudget(research.id, 0)
  assert.deepEqual(getAgentBudgets(), {})
  assert.equal(getSetting("usage.agentBudgets"), undefined)
  assert.equal(budgetBlock(PAID, research.id), null)

  setAgentBudget(research.id, 0.01)
  setAgentBudget(research.id, -1)
  assert.deepEqual(getAgentBudgets(), {})
  assert.equal(budgetBlock(PAID, research.id), null)

  setAgentBudget(research.id, 0.01)
  setAgentBudget(research.id, null)
  assert.equal(getSetting("usage.agentBudgets"), undefined)
})

test("counts a delegated turn toward that agent only", () => {
  const starter = makeAgent("Starter")
  const delegate = makeAgent("Delegate")
  setAgentBudget(starter.id, 0.01)
  setAgentBudget(delegate.id, 0.01)
  recordSpend(delegate.id, 0.05)

  assert.equal(budgetBlock(PAID, starter.id), null)
  assert.match(budgetBlock(PAID, delegate.id)!, /Delegate/)
  assert.equal(agentMonthSpend(delegate.id), 0.05)
  assert.equal(agentMonthSpend(starter.id), 0)
})

test("still applies the global budget when the agent is under its own limit", () => {
  const research = makeAgent("Research")
  const writer = makeAgent("Writer")
  setAgentBudget(research.id, 10)
  setSetting("usage.monthlyBudget", "0.01")
  recordSpend(writer.id, 0.02)

  const blocked = budgetBlock(PAID, research.id)
  assert.match(blocked!, /budget/i)
  assert.match(blocked!, /\$0\.01/)
  assert.equal(budgetBlock(PAID, writer.id) === null, false)
})

test("never blocks local or unpriced models", () => {
  const research = makeAgent("Research")
  setAgentBudget(research.id, 0.01)
  setSetting("usage.monthlyBudget", "0.01")
  recordSpend(research.id, 1)

  assert.equal(budgetBlock(LOCAL, research.id), null)
  assert.equal(budgetBlock(UNPRICED, research.id), null)
})

test("ignores spend from before this month and turns with no price", () => {
  const research = makeAgent("Research")
  setAgentBudget(research.id, 0.01)
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
  recordSpend(research.id, 5, lastMonth)
  db.insert(turns)
    .values({
      agentId: research.id,
      model: UNPRICED,
      costMicros: null,
      status: "completed",
    })
    .run()

  assert.equal(agentMonthSpend(research.id), 0)
  assert.equal(budgetBlock(PAID, research.id), null)
})

test("blocks when spend is exactly the limit", () => {
  const research = makeAgent("Research")
  setAgentBudget(research.id, 0.01)
  recordSpend(research.id, 0.01)

  assert.match(budgetBlock(PAID, research.id)!, /\$0\.01/)
})
