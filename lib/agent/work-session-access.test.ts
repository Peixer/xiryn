import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"

import type { Agent } from "@/db/schema"

import { buildInstructions } from "./instructions"
import { canSpawnWorkSession, workSessionToolsForTurn } from "./work-session-access"

const env = {
  current: () => ({ id: "agent" }) as Agent,
  threadId: "thread",
}

test("a routine turn does not get spawn_work_session", () => {
  assert.equal(
    canSpawnWorkSession({ workstation: true, routine: true, wake: false }),
    false
  )
  const tools = workSessionToolsForTurn(env, {
    workstation: true,
    routine: true,
    wake: false,
  })
  assert.equal("spawn_work_session" in tools, false)
  assert.equal("list_work_sessions" in tools, true)
  assert.equal("get_work_session" in tools, true)
  assert.equal("cancel_work_session" in tools, true)
})

test("a coding-session wake does not get spawn_work_session", () => {
  assert.equal(
    canSpawnWorkSession({ workstation: true, routine: false, wake: true }),
    false
  )
  const tools = workSessionToolsForTurn(env, {
    workstation: true,
    routine: false,
    wake: true,
  })
  assert.equal("spawn_work_session" in tools, false)
  assert.equal("cancel_work_session" in tools, true)
})

test("an owner-present turn with a workstation can spawn", () => {
  assert.equal(
    canSpawnWorkSession({ workstation: true, routine: false, wake: false }),
    true
  )
  const tools = workSessionToolsForTurn(env, {
    workstation: true,
    routine: false,
    wake: false,
  })
  assert.equal("spawn_work_session" in tools, true)
  if (!("spawn_work_session" in tools)) return
  assert.equal(typeof tools.spawn_work_session.execute, "function")
})

test("a routine and a wake together still omit the tool", () => {
  const tools = workSessionToolsForTurn(env, {
    workstation: true,
    routine: true,
    wake: true,
  })
  assert.equal("spawn_work_session" in tools, false)
})

test("without a workstation there are no coding-session tools", () => {
  assert.equal(
    canSpawnWorkSession({ workstation: false, routine: false, wake: false }),
    false
  )
  const tools = workSessionToolsForTurn(env, {
    workstation: false,
    routine: false,
    wake: false,
  })
  assert.deepEqual(tools, {})
})

test("startTurn builds coding-session tools through this gate", () => {
  const source = fs.readFileSync(new URL("./runtime.ts", import.meta.url), "utf8")
  assert.match(source, /workSessionToolsForTurn\(env,/)
  assert.match(source, /routine:\s*!!routine/)
  assert.match(source, /wake:\s*!!wake/)
})

const coding = {
  id: "agent",
  name: "Orch",
  role: "coding",
  instructions: null,
  category: "coding",
} as Agent

test("an owner-present coding prompt still tells the agent how to spawn", () => {
  const prompt = buildInstructions(coding, {
    workstation: true,
    web: false,
    ownerPresent: true,
  })
  assert.match(prompt, /spawn_work_session/)
  assert.match(prompt, /End your turn after spawning/)
  assert.match(prompt, /dangerously-bypass-approvals-and-sandbox/)
  assert.match(prompt, /\/home\/xiryn/)
})

test("an unattended coding prompt does not hand over the bypass flags", () => {
  for (const capabilities of [
    { workstation: true, web: false, ownerPresent: false, routine: "Nightly" },
    { workstation: true, web: false, ownerPresent: false },
  ]) {
    const prompt = buildInstructions(coding, capabilities)
    assert.match(prompt, /spawn_work_session is not available/)
    assert.doesNotMatch(prompt, /dangerously-bypass-approvals-and-sandbox/)
    assert.doesNotMatch(prompt, /dangerously-skip-permissions/)
    assert.doesNotMatch(prompt, /End your turn after spawning/)
  }
})
