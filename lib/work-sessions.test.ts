import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  workSessions,
  upsertSession,
  getSession,
  getSessions,
  getActiveSessions,
  cleanupOldSessions,
  appendSessionOutput,
  type WorkSession,
} from "./work-sessions"
beforeEach(() => workSessions.clear())
const session = (
  id: string,
  status: WorkSession["status"] = "running",
  startedAt = new Date()
): WorkSession => ({
  id,
  status,
  startedAt,
  agentId: "a",
  agentName: "Agent",
  task: "test",
  tool: "codex",
  branch: "task/test",
  repoPath: "/tmp/repo",
  output: [],
})
test("upserts, retrieves and sorts sessions", () => {
  upsertSession(session("old", "done", new Date(0)))
  upsertSession(session("new"))
  assert.equal(getSession("new")?.id, "new")
  assert.deepEqual(
    getSessions().map((s) => s.id),
    ["new", "old"]
  )
  upsertSession(session("new", "failed"))
  assert.equal(getSessions().length, 2)
})
test("filters active sessions", () => {
  upsertSession(session("a"))
  upsertSession(session("b", "done"))
  upsertSession(session("c", "failed"))
  assert.deepEqual(
    getActiveSessions().map((s) => s.id),
    ["a"]
  )
})
test("cleans old completed sessions and preserves running ones", () => {
  upsertSession(session("old", "done", new Date(0)))
  upsertSession(session("running", "running", new Date(0)))
  upsertSession(session("recent", "done"))
  cleanupOldSessions()
  assert.equal(getSession("old"), undefined)
  assert.ok(getSession("running"))
  assert.ok(getSession("recent"))
})
test("appends and bounds streaming output", () => {
  upsertSession(session("a"))
  appendSessionOutput("a", "hello\n")
  assert.equal(getSession("a")?.output.join(""), "hello\n")
  appendSessionOutput("a", "x".repeat(30_000))
  assert.equal(getSession("a")?.output[1].length, 20_000)
})
