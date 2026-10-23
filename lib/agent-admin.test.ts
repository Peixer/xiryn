import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"

import type { DeleteAgentDeps, DeleteAgentError } from "./agent-admin"

// A throwaway database: the real schema and migrations, nothing of the user's
process.env.XIRYN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-agent-admin-"))

const { db, sqlite } = await import("@/db")
const schema = await import("@/db/schema")
const admin = await import("./agent-admin")

const { agents, memories, messages, routines, squadMembers, squads, threads, turns } =
  schema

after(() => {
  sqlite.close()
  fs.rmSync(process.env.XIRYN_DATA_DIR!, { recursive: true, force: true })
})

function makeAgent(name: string) {
  const [agent] = db.insert(agents).values({ name, role: "tester" }).returning().all()
  return agent
}

function makeThread(owner: { agentId?: string; squadId?: string }, activeAt?: Date) {
  const [thread] = db
    .insert(threads)
    .values({ ...owner, ...(activeAt && { activeAt }) })
    .returning()
    .all()
  return thread
}

function say(threadId: string, text: string) {
  db.insert(messages)
    .values({
      id: `${threadId}-${text}`,
      threadId,
      role: "user",
      parts: [{ type: "text", text }],
    })
    .run()
}

type Calls = { stopped: string[]; destroyed: string[] }

function fakeDeps(
  options: {
    active?: () => string[]
    engine?: boolean
    remains?: boolean
    onStop?: (threadId: string) => void
  } = {}
) {
  const calls: Calls = { stopped: [], destroyed: [] }
  const deps: DeleteAgentDeps = {
    activeThreadIds: options.active ?? (() => []),
    stopRun: (threadId) => {
      calls.stopped.push(threadId)
      options.onStop?.(threadId)
      return true
    },
    engineReady: () => options.engine ?? true,
    destroyWorkstation: async (agentId) => {
      calls.destroyed.push(agentId)
    },
    workstationRemains: async () => options.remains ?? false,
    settleMs: 300,
  }
  return { deps, calls }
}

const count = (table: string, where = "1=1") =>
  (
    sqlite.prepare(`select count(*) as n from ${table} where ${where}`).get() as {
      n: number
    }
  ).n

before(() => {
  assert.equal(count("agents"), 0)
})

test("footprints count what an agent owns", () => {
  const agent = makeAgent("Counter")
  const other = makeAgent("Other")
  const first = makeThread({ agentId: agent.id }, new Date("2026-01-01T10:00:00Z"))
  const second = makeThread({ agentId: agent.id }, new Date("2026-02-01T10:00:00Z"))
  say(first.id, "a")
  say(first.id, "b")
  say(second.id, "c")
  makeThread({ agentId: other.id })
  db.insert(memories).values({ agentId: agent.id, content: "likes tea" }).run()
  db.insert(routines)
    .values({
      name: "brief",
      agentId: agent.id,
      prompt: "go",
      schedule: { kind: "daily", time: "08:00" },
    })
    .run()
  const [squad] = db.insert(squads).values({ name: "Duo" }).returning().all()
  db.insert(squadMembers)
    .values([
      { squadId: squad.id, agentId: agent.id, position: 0 },
      { squadId: squad.id, agentId: other.id, position: 1 },
    ])
    .run()

  const footprint = admin.agentFootprint(agent.id)
  assert.equal(footprint.threads, 2)
  assert.equal(footprint.messages, 3)
  assert.equal(footprint.memories, 1)
  assert.equal(footprint.routines, 1)
  assert.deepEqual(footprint.squads, [{ id: squad.id, name: "Duo", members: 2 }])
  assert.equal(footprint.lastActiveAt?.toISOString(), "2026-02-01T10:00:00.000Z")

  const all = admin.agentFootprints()
  assert.equal(all.get(other.id)?.threads, 1)
  assert.equal(all.get(other.id)?.memories, 0)
  // An agent with nothing still reads as zeros
  const empty = makeAgent("Empty")
  assert.equal(admin.agentFootprint(empty.id).threads, 0)
  assert.equal(admin.agentFootprint(empty.id).lastActiveAt, null)
})

test("deleting removes the agent's rows, keeps everyone else's, and destroys the workstation", async () => {
  const doomed = makeAgent("Doomed")
  const keeper = makeAgent("Keeper")
  const mine = makeThread({ agentId: doomed.id })
  const theirs = makeThread({ agentId: keeper.id })
  say(mine.id, "bye")
  say(theirs.id, "stay")
  db.insert(memories).values({ agentId: doomed.id, content: "secret" }).run()
  db.insert(memories).values({ agentId: keeper.id, content: "keep" }).run()
  const [routine] = db
    .insert(routines)
    .values({
      name: "doomed routine",
      agentId: doomed.id,
      threadId: mine.id,
      prompt: "x",
      schedule: { kind: "daily", time: "09:00" },
    })
    .returning()
    .all()
  // A ledger row keeps its cost after the agent is gone
  db.insert(turns)
    .values({ threadId: mine.id, agentId: doomed.id, model: "x/y", status: "completed" })
    .run()
  // A duo with the keeper survives (with one member); a solo-doomed squad does not
  const [duo] = db.insert(squads).values({ name: "Survivor" }).returning().all()
  db.insert(squadMembers)
    .values([
      { squadId: duo.id, agentId: doomed.id, position: 0 },
      { squadId: duo.id, agentId: keeper.id, position: 1 },
    ])
    .run()
  const squadThread = makeThread({ squadId: duo.id })
  const [alone] = db.insert(squads).values({ name: "Only doomed" }).returning().all()
  db.insert(squadMembers).values({ squadId: alone.id, agentId: doomed.id }).run()

  const { deps, calls } = fakeDeps()
  const result = await admin.deleteAgentSafely(doomed.id, deps)

  assert.equal(result.name, "Doomed")
  assert.equal(result.workstation, "removed")
  assert.deepEqual(calls.destroyed, [doomed.id])
  assert.equal(result.removed.threads, 1)
  assert.equal(result.removed.memories, 1)
  assert.equal(result.removed.routines, 1)

  assert.equal(count("agents", `id = '${doomed.id}'`), 0)
  assert.equal(count("threads", `id = '${mine.id}'`), 0)
  assert.equal(count("messages", `thread_id = '${mine.id}'`), 0)
  assert.equal(count("memories", `agent_id = '${doomed.id}'`), 0)
  assert.equal(count("routines", `id = '${routine.id}'`), 0)
  assert.equal(count("squad_members", `agent_id = '${doomed.id}'`), 0)
  assert.equal(count("squads", `id = '${alone.id}'`), 0)
  // Ledger kept, detached
  const ledger = sqlite
    .prepare("select agent_id, thread_id from turns where model = 'x/y'")
    .get() as {
    agent_id: string | null
    thread_id: string | null
  }
  assert.deepEqual(ledger, { agent_id: null, thread_id: null })

  // Untouched
  assert.equal(count("agents", `id = '${keeper.id}'`), 1)
  assert.equal(count("messages", `thread_id = '${theirs.id}'`), 1)
  assert.equal(count("memories", `agent_id = '${keeper.id}'`), 1)
  assert.equal(count("squads", `id = '${duo.id}'`), 1)
  assert.equal(count("threads", `id = '${squadThread.id}'`), 1)
  assert.equal(count("squad_members", `squad_id = '${duo.id}'`), 1)
})

test("an unknown agent is rejected", async () => {
  await assert.rejects(
    admin.deleteAgentSafely("nope", fakeDeps().deps),
    (error: DeleteAgentError) => error.code === "not-found"
  )
})

test("a running turn blocks deletion unless told to stop it", async () => {
  const agent = makeAgent("Busy")
  const thread = makeThread({ agentId: agent.id })
  const { deps, calls } = fakeDeps({ active: () => [thread.id] })

  await assert.rejects(
    admin.deleteAgentSafely(agent.id, deps),
    (error: DeleteAgentError) =>
      error.code === "busy" && /Busy is working/.test(error.message)
  )
  // Nothing was touched
  assert.equal(count("agents", `id = '${agent.id}'`), 1)
  assert.deepEqual(calls.stopped, [])
  assert.deepEqual(calls.destroyed, [])
})

test("with stopRunning, runs are stopped and waited for before anything is deleted", async () => {
  const agent = makeAgent("Stoppable")
  const peer = makeAgent("Peer")
  const own = makeThread({ agentId: agent.id })
  const [squad] = db.insert(squads).values({ name: "Pair" }).returning().all()
  db.insert(squadMembers)
    .values([
      { squadId: squad.id, agentId: agent.id, position: 0 },
      { squadId: squad.id, agentId: peer.id, position: 1 },
    ])
    .run()
  const shared = makeThread({ squadId: squad.id })

  // Runs wind down a little after being asked to
  let running = [own.id, shared.id]
  const { deps, calls } = fakeDeps({
    active: () => running,
    onStop: (threadId) => {
      setTimeout(() => (running = running.filter((id) => id !== threadId)), 80)
    },
  })
  const original = deps.destroyWorkstation
  deps.destroyWorkstation = async (id) => {
    // By now every run has ended
    assert.deepEqual(running, [])
    return original(id)
  }

  const result = await admin.deleteAgentSafely(agent.id, deps, { stopRunning: true })
  assert.deepEqual(calls.stopped.sort(), [own.id, shared.id].sort())
  assert.equal(result.stoppedRuns, 2)
  assert.equal(count("agents", `id = '${agent.id}'`), 0)
  // The squad and its thread survive with the peer
  assert.equal(count("threads", `id = '${shared.id}'`), 1)
})

test("a turn that won't stop leaves everything in place", async () => {
  const agent = makeAgent("Stubborn")
  const thread = makeThread({ agentId: agent.id })
  const { deps, calls } = fakeDeps({ active: () => [thread.id] })
  await assert.rejects(
    admin.deleteAgentSafely(agent.id, deps, { stopRunning: true }),
    (error: DeleteAgentError) => error.code === "stuck"
  )
  assert.deepEqual(calls.stopped, [thread.id])
  assert.equal(count("agents", `id = '${agent.id}'`), 1)
  assert.deepEqual(calls.destroyed, [])
})

test("another agent's run doesn't block deletion", async () => {
  const agent = makeAgent("Idle")
  const other = makeAgent("Working")
  const thread = makeThread({ agentId: other.id })
  const { deps } = fakeDeps({ active: () => [thread.id] })
  await admin.deleteAgentSafely(agent.id, deps)
  assert.equal(count("agents", `id = '${agent.id}'`), 0)
  assert.equal(count("agents", `id = '${other.id}'`), 1)
})

test("with Docker off, the workstation is left to the janitor", async () => {
  const agent = makeAgent("Offline")
  const { deps, calls } = fakeDeps({ engine: false })
  const result = await admin.deleteAgentSafely(agent.id, deps)
  assert.equal(result.workstation, "pending")
  assert.deepEqual(calls.destroyed, [])
  assert.equal(count("agents", `id = '${agent.id}'`), 0)
})

test("a workstation that survives removal is reported as pending", async () => {
  const agent = makeAgent("Sticky")
  const { deps } = fakeDeps({ remains: true })
  const result = await admin.deleteAgentSafely(agent.id, deps)
  assert.equal(result.workstation, "pending")
})
