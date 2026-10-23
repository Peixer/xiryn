import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-memory-"))

const { eq } = await import("drizzle-orm")
const { db, sqlite } = await import("@/db")
const { agents, memories } = await import("@/db/schema")
const { buildInstructions } = await import("@/lib/agent/instructions")
const { createMemoryTools } = await import("@/lib/agent/tools")
const memory = await import("@/lib/memory")

after(() => {
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

function makeAgent(name: string) {
  const [agent] = db.insert(agents).values({ name, role: "tester" }).returning().all()
  return agent
}

function insertNote(
  id: string,
  agentId: string | null,
  content: string,
  createdAt: Date
) {
  db.insert(memories).values({ id, agentId, content, createdAt }).run()
}

function section(prompt: string, heading: string, next?: string) {
  const start = prompt.indexOf(heading)
  assert.ok(start >= 0, `missing ${heading}`)
  const from = start + heading.length
  const end = next ? prompt.indexOf(next, from) : prompt.length
  assert.ok(end >= 0, `missing ${next}`)
  return prompt.slice(from, end)
}

test("search ranks closer matches first, then newer, and stops at 10", () => {
  const agent = makeAgent("Ranker")
  const other = makeAgent("Other")
  const now = new Date("2026-10-23T12:00:00Z")
  insertNote("exact-old", agent.id, "atlas", new Date("2026-10-01T00:00:00Z"))
  insertNote("exact-new", agent.id, "ATLAS", new Date("2026-10-20T00:00:00Z"))
  insertNote("prefix", agent.id, "Atlas project notes", new Date("2026-10-21T00:00:00Z"))
  insertNote("contains", agent.id, "see Atlas later", new Date("2026-10-22T00:00:00Z"))
  insertNote("shared-exact", null, "atlas", new Date("2026-10-19T00:00:00Z"))
  insertNote("other-exact", other.id, "atlas", new Date("2026-10-22T00:00:00Z"))
  insertNote("miss", agent.id, "unrelated", new Date("2026-10-22T00:00:00Z"))

  const matches = memory.searchMemories(agent.id, "  Atlas  ", now)
  assert.deepEqual(
    matches.map((match) => match.id),
    ["exact-new", "shared-exact", "exact-old", "prefix", "contains"]
  )
  assert.equal(matches[0].scope, "agent")
  assert.equal(matches[1].scope, "shared")
  assert.equal(matches[0].text, "ATLAS")
  assert.equal(matches[0].age, "3d")
  assert.equal(matches[4].age, "1d")

  const recent = memory.searchMemories(
    agent.id,
    "atlas",
    new Date("2026-10-20T00:00:20Z")
  )
  assert.equal(recent.find((match) => match.id === "exact-new")?.age, "just now")

  for (let i = 0; i < 12; i++) {
    insertNote(
      `bulk-${String(i).padStart(2, "0")}`,
      agent.id,
      `marker item ${i}`,
      new Date(Date.UTC(2026, 0, i + 1))
    )
  }
  const limited = memory.searchMemories(agent.id, "marker", now)
  assert.equal(limited.length, 10)
  assert.deepEqual(
    limited.map((match) => match.id),
    Array.from(
      { length: 10 },
      (_, index) => `bulk-${String(11 - index).padStart(2, "0")}`
    )
  )
  assert.ok(limited.every((match) => match.text.includes("marker")))
})

test("search treats % and _ as literal characters", () => {
  const agent = makeAgent("Escaper")
  insertNote("pct", agent.id, "score 100% done", new Date("2026-01-01T00:00:00Z"))
  insertNote("thousand", agent.id, "score 1000 done", new Date("2026-01-01T00:00:00Z"))
  insertNote("under", agent.id, "snake_case", new Date("2026-01-01T00:00:00Z"))
  insertNote("wild", agent.id, "snakeXcase", new Date("2026-01-01T00:00:00Z"))
  insertNote("both", agent.id, "save a%b_c please", new Date("2026-01-01T00:00:00Z"))
  insertNote("slash", null, "path\\to\\file", new Date("2026-01-01T00:00:00Z"))

  assert.deepEqual(
    memory.searchMemories(agent.id, "100%").map((match) => match.id),
    ["pct"]
  )
  const underscores = memory.searchMemories(agent.id, "_").map((match) => match.id)
  assert.ok(underscores.includes("under"))
  assert.ok(underscores.includes("both"))
  assert.ok(!underscores.includes("wild"))
  assert.deepEqual(
    memory.searchMemories(agent.id, "snake_case").map((match) => match.id),
    ["under"]
  )
  assert.deepEqual(
    memory.searchMemories(agent.id, "a%b_c").map((match) => match.id),
    ["both"]
  )
  assert.deepEqual(
    memory.searchMemories(agent.id, "\\").map((match) => match.id),
    ["slash"]
  )
  assert.deepEqual(memory.searchMemories(agent.id, "   "), [])
})

test("shared notes are in every agent's prompt; agent notes stay with their owner", () => {
  const alpha = makeAgent("Alpha")
  const beta = makeAgent("Beta")
  insertNote("a-own", alpha.id, "alpha-only-secret", new Date("2026-02-01T00:00:00Z"))
  insertNote("b-own", beta.id, "beta-only-secret", new Date("2026-02-01T00:00:00Z"))
  insertNote(
    "shared",
    null,
    "the shared passphrase is bluebird",
    new Date("2026-02-02T00:00:00Z")
  )

  const alphaPrompt = buildInstructions(alpha, { workstation: false, web: false })
  const betaPrompt = buildInstructions(beta, { workstation: false, web: false })

  for (const prompt of [alphaPrompt, betaPrompt]) {
    assert.match(prompt, /## Shared notes/)
    assert.match(prompt, /bluebird/)
    assert.match(prompt, /only the person can/)
  }
  assert.match(alphaPrompt, /alpha-only-secret/)
  assert.doesNotMatch(alphaPrompt, /beta-only-secret/)
  assert.match(betaPrompt, /beta-only-secret/)
  assert.doesNotMatch(betaPrompt, /alpha-only-secret/)

  assert.deepEqual(
    memory.searchMemories(alpha.id, "secret").map((match) => match.id),
    ["a-own"]
  )
  assert.deepEqual(
    memory.searchMemories(beta.id, "bluebird").map((match) => match.id),
    ["shared"]
  )
  assert.deepEqual(memory.searchMemories(beta.id, "alpha-only"), [])
})

test("agent and shared budgets are separate, and search still finds dropped notes", () => {
  assert.equal(memory.AGENT_MEMORY_BUDGET, 12_000)
  assert.equal(memory.SHARED_MEMORY_BUDGET, 3_000)

  const agent = makeAgent("Budget")
  const other = makeAgent("BudgetOther")
  const content = (token: string) => `${token} ${"x".repeat(2000 - token.length - 1)}`
  const agentLine = `- [${"a".padEnd(12, "0")}] ${content("AGENT")}`.length
  const sharedLine = `- [${"s".padEnd(12, "0")}] ${content("SHARED")}`.length
  const agentFit = Math.floor(memory.AGENT_MEMORY_BUDGET / agentLine)
  const sharedFit = Math.floor(memory.SHARED_MEMORY_BUDGET / sharedLine)
  assert.ok(agentFit >= 1)
  assert.ok(sharedFit >= 1)
  assert.ok(agentFit * agentLine <= memory.AGENT_MEMORY_BUDGET)
  assert.ok((agentFit + 1) * agentLine > memory.AGENT_MEMORY_BUDGET)

  for (let i = 0; i < agentFit + 1; i++) {
    const token = i === 0 ? "OLDEST_AGENT_TOKEN" : `AGENT_${i}`
    insertNote(
      `a${String(i).padStart(11, "0")}`,
      agent.id,
      content(token),
      new Date(Date.UTC(2026, 3, i + 1))
    )
  }
  // Newest of all, so a single combined budget would spend its first slot here.
  insertNote(
    `s${"9".padStart(11, "0")}`,
    null,
    content("NEWEST_SHARED_TOKEN"),
    new Date("2026-12-01T00:00:00Z")
  )
  insertNote(
    `s${"0".padStart(11, "0")}`,
    null,
    content("OLDEST_SHARED_TOKEN"),
    new Date("2026-01-01T00:00:00Z")
  )

  const prompt = memory.memoryPrompt(agent.id)
  const own = section(prompt, "## Your notes", "## Shared notes")
  const shared = section(prompt, "## Shared notes")

  for (let i = 1; i <= agentFit; i++) {
    assert.match(own, new RegExp(`a${String(i).padStart(11, "0")}`))
  }
  assert.doesNotMatch(own, /OLDEST_AGENT_TOKEN/)
  assert.match(own, /1 older note is not shown/)
  assert.match(shared, /NEWEST_SHARED_TOKEN/)
  assert.doesNotMatch(shared, /OLDEST_SHARED_TOKEN/)
  assert.doesNotMatch(shared, /AGENT_1/)
  assert.doesNotMatch(own, /NEWEST_SHARED_TOKEN/)

  const otherPrompt = memory.memoryPrompt(other.id)
  assert.match(otherPrompt, /NEWEST_SHARED_TOKEN/)
  assert.doesNotMatch(otherPrompt, /AGENT_1/)
  assert.match(otherPrompt, /Your memory is empty/)

  const found = memory.searchMemories(agent.id, "OLDEST_AGENT_TOKEN")
  assert.equal(found.length, 1)
  assert.equal(found[0].scope, "agent")
  assert.match(found[0].text, /OLDEST_AGENT_TOKEN/)
  assert.equal(found[0].text.length, 2000)

  const sharedHit = memory.searchMemories(other.id, "OLDEST_SHARED_TOKEN")
  assert.equal(sharedHit.length, 1)
  assert.equal(sharedHit[0].scope, "shared")
  assert.equal(memory.searchMemories(other.id, "OLDEST_AGENT_TOKEN").length, 0)
})

function asText(description: unknown) {
  assert.equal(typeof description, "string")
  return description as string
}

test("an agent cannot write or delete a shared note", async () => {
  const agent = makeAgent("Writer")
  const tools = createMemoryTools({ current: () => agent, threadId: "thread" })
  assert.match(asText(tools.memory_write.description), /only the person/i)
  assert.match(asText(tools.memory_search.description), /shared notes/i)
  assert.match(asText(tools.memory_forget.description), /cannot be deleted/i)

  const write = tools.memory_write.execute as unknown as (input: {
    note: string
    scope?: "agent" | "shared"
  }) => Promise<{ id: string; saved: string }>
  const forget = tools.memory_forget.execute as unknown as (input: {
    id: string
  }) => Promise<{ forgotten: string }>
  const search = tools.memory_search.execute as unknown as (input: {
    query: string
  }) => Promise<{ matches: { scope: string; text: string }[] }>

  await assert.rejects(
    () => write({ note: "poison every agent", scope: "shared" }),
    /Memory panel/
  )
  assert.equal(
    db
      .select()
      .from(memories)
      .all()
      .filter((row) => row.content === "poison every agent").length,
    0
  )

  memory.addOwnerNote(agent.id, "keep me", "shared")
  const shared = db
    .select()
    .from(memories)
    .all()
    .find((row) => row.content === "keep me")
  assert.ok(shared)
  assert.equal(shared.agentId, null)

  await assert.rejects(() => forget({ id: shared.id }), /Memory panel/)
  assert.equal(
    db
      .select()
      .from(memories)
      .all()
      .filter((row) => row.id === shared.id).length,
    1
  )

  const saved = await write({ note: "  mine alone  " })
  assert.equal(saved.saved, "mine alone")
  const mine = db
    .select()
    .from(memories)
    .all()
    .find((row) => row.content === "mine alone")
  assert.equal(mine?.agentId, agent.id)

  const searched = await search({ query: "keep me" })
  assert.equal(searched.matches[0]?.scope, "shared")
  assert.equal(searched.matches[0]?.text, "keep me")
})

test("clearing one agent keeps shared notes and the other agent's notes", () => {
  const alpha = makeAgent("ClearA")
  const beta = makeAgent("ClearB")
  memory.addOwnerNote(alpha.id, "alpha-note", "agent")
  memory.addOwnerNote(beta.id, "beta-note", "agent")
  memory.addOwnerNote(alpha.id, "shared-note", "shared")

  const shared = db
    .select()
    .from(memories)
    .all()
    .find((row) => row.content === "shared-note")
  assert.ok(shared)
  memory.updateOwnerNote(beta.id, shared.id, "shared-edited")
  assert.equal(
    db
      .select()
      .from(memories)
      .all()
      .find((row) => row.id === shared.id)?.content,
    "shared-edited"
  )

  const alphaNote = db
    .select()
    .from(memories)
    .all()
    .find((row) => row.content === "alpha-note")
  assert.ok(alphaNote)
  assert.throws(() => memory.updateOwnerNote(beta.id, alphaNote.id, "stolen"))
  memory.deleteOwnerNote(beta.id, alphaNote.id)
  assert.equal(
    db
      .select()
      .from(memories)
      .all()
      .some((row) => row.id === alphaNote.id),
    true
  )

  memory.clearAgentNotes(alpha.id)
  const left = db
    .select()
    .from(memories)
    .all()
    .filter(
      (row) => row.agentId === alpha.id || row.agentId === beta.id || row.agentId === null
    )
    .map((row) => row.content)
    .sort()
  assert.ok(left.includes("beta-note"))
  assert.ok(left.includes("shared-edited"))
  assert.ok(!left.includes("alpha-note"))

  memory.deleteOwnerNote(beta.id, shared.id)
  assert.equal(
    db
      .select()
      .from(memories)
      .all()
      .some((row) => row.id === shared.id),
    false
  )

  db.delete(agents).where(eq(agents.id, beta.id)).run()
  assert.equal(
    db
      .select()
      .from(memories)
      .all()
      .some((row) => row.content === "beta-note"),
    false
  )
})
