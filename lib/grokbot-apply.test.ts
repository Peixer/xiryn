import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-grokbot-"))
process.env.XIRYN_DATA_DIR = path.join(root, "data")
const skillsRoot = path.join(root, "skills")

const { eq } = await import("drizzle-orm")
const { db, sqlite } = await import("@/db")
const { agents, memories, routines } = await import("@/db/schema")
const { parseGrokbotDocument } = await import("./grokbot-import")
const { applyGrokbotPlan } = await import("./grokbot-apply")
const { memoryPrompt } = await import("./memory")
const { readSkill } = await import("./skills")

const fixture = fs.readFileSync(
  path.join(process.cwd(), "tests/fixtures/grokbot-agent.json"),
  "utf8"
)

function plan() {
  const parsed = parseGrokbotDocument(fixture, {
    takenNames: db
      .select({ name: agents.name })
      .from(agents)
      .all()
      .map((row) => row.name),
    takenSlugs: [],
    skillRoom: 64,
  })
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.plan
}

after(() => {
  sqlite.close()
  fs.rmSync(root, { recursive: true, force: true })
})

test("apply writes the agent, memories, paused routines and skills", () => {
  const result = applyGrokbotPlan(plan(), { skillsRoot })
  assert.equal(result.agent.name, "Mira Example")
  assert.equal(result.memories, 2)
  assert.equal(result.routines, 3)
  assert.equal(result.onboardingSkill, "Sample welcome")
  assert.equal(
    result.skills.map((skill) => skill.slug).join(","),
    "sample-filing,sample-welcome"
  )

  const routineRows = db.select().from(routines).all()
  assert.equal(routineRows.length, 3)
  assert.equal(
    routineRows.every((routine) => routine.enabled === false),
    true
  )
  assert.equal(
    routineRows.every((routine) => routine.nextRunAt === null),
    true
  )
  const weekday = routineRows.find((routine) => routine.name === "Weekday slips")
  assert.deepEqual(weekday?.schedule, { kind: "weekdays", time: "08:15" })
  const unscheduled = routineRows.find((routine) => routine.name === "Unscheduled sample")
  assert.equal(unscheduled?.schedule, null)

  const notes = db
    .select()
    .from(memories)
    .where(eq(memories.agentId, result.agent.id))
    .all()
  assert.equal(notes.length, 2)
  const profile = notes.find((note) => note.content.includes("MX-42"))
  assert.ok(profile)
  assert.equal(profile?.createdAt.toISOString().slice(0, 10), "2024-04-02")
  const prompt = memoryPrompt(result.agent.id)
  assert.match(prompt, /<untrusted source="grokbot-import">/)
  assert.match(prompt, /Imported history/)
  assert.equal(prompt.match(/<\/untrusted>/g)?.length, 2)

  const skill = readSkill("sample-welcome", { root: skillsRoot })
  assert.equal(skill?.source, "grokbot-import")
  assert.match(skill?.body ?? "", /sample onboarding/)
})

test("importing the same template again renames the agent and the skills", () => {
  const result = applyGrokbotPlan(plan(), { skillsRoot })
  assert.equal(result.agent.name, "Mira Example (2)")
  assert.equal(result.renamedFrom, "Mira Example")
  assert.deepEqual(
    result.skills.map((skill) => skill.slug),
    ["sample-filing-2", "sample-welcome-2"]
  )
  const original = readSkill("sample-filing", { root: skillsRoot })
  assert.match(original?.body ?? "", /one-line pretend filing slip/)
  assert.equal(db.select().from(agents).all().length, 2)
})

test("a failure inside the transaction removes the agent and the new skills", () => {
  const beforeAgents = db.select().from(agents).all().length
  const beforeSkills = fs.readdirSync(skillsRoot).sort()
  assert.throws(
    () =>
      applyGrokbotPlan(plan(), {
        skillsRoot,
        beforeCommit: () => {
          throw new Error("boom")
        },
      }),
    /boom/
  )
  assert.equal(db.select().from(agents).all().length, beforeAgents)
  assert.deepEqual(fs.readdirSync(skillsRoot).sort(), beforeSkills)
})
