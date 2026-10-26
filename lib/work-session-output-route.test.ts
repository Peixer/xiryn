import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-output-api-"))
process.env.XIRYN_DATA_DIR = dir

const githubPat = `ghp_${"C".repeat(36)}`
const openai = `sk-proj-${"e".repeat(40)}`
const credentialUrl = "https://ci-user:p@ssw0rd@github.com/acme/private.git"

type OutputResponse = {
  id?: string
  output?: string
  error?: string | null
  status?: string
}

let GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let upsertSession: (session: {
  id: string
  status: "running"
  startedAt: Date
  agentId: string
  agentName: string
  task: string
  tool: "codex"
  branch: string
  repoPath: string
  output: string[]
}) => void
let workSessions: Map<string, unknown>
let sqlite: import("better-sqlite3").Database

before(async () => {
  const route = await import("../app/api/work-sessions/[id]/output/route")
  const sessions = await import("./work-sessions")
  const db = await import("@/db")
  GET = route.GET
  upsertSession = sessions.upsertSession
  workSessions = sessions.workSessions
  sqlite = db.sqlite
})

after(() => {
  sqlite.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test("the output route redacts live chunks and stored rows", async () => {
  workSessions.clear()
  upsertSession({
    id: "live-session",
    status: "running",
    startedAt: new Date(),
    agentId: "agent",
    agentName: "Agent",
    task: "test",
    tool: "codex",
    branch: "task/live",
    repoPath: "/tmp/repo",
    output: [githubPat.slice(0, 8), `${githubPat.slice(8)}\n${openai}\n`],
  })
  const live = await read("live-session")
  assert.equal(live.status, 200)
  const liveBody = (await live.json()) as OutputResponse
  assert.equal(liveBody.output?.includes(githubPat), false)
  assert.equal(liveBody.output?.includes(openai), false)
  assert.match(liveBody.output ?? "", /\[redacted\]/)

  workSessions.clear()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO agents (id, name, role, instructions, glyph, created_at, updated_at)
       VALUES (?, 'Agent', 'orchestrator', 'test', 'glyph', ?, ?)`
    )
    .run("agent", now, now)
  sqlite
    .prepare(
      `INSERT INTO threads (id, agent_id, ephemeral, parent_thread_id, title, active_at, created_at)
       VALUES ('thread', 'agent', 0, NULL, 'Agent', ?, ?)`
    )
    .run(now, now)
  sqlite
    .prepare(
      `INSERT INTO work_session_batches
         (id, agent_id, thread_id, wake_status, created_at)
       VALUES ('batch', 'agent', 'thread', 'woken', ?)`
    )
    .run(now)
  sqlite
    .prepare(
      `INSERT INTO work_sessions
         (id, batch_id, agent_id, thread_id, agent_name, task, tool, branch, repo_path,
          base_branch, status, started_at, output, error)
       VALUES ('stored-session', 'batch', 'agent', 'thread', 'Agent', 'task', 'codex',
               'task/stored', '/repo', 'main', 'done', ?, ?, ?)`
    )
    .run(now, `clone ${credentialUrl}\n${githubPat}\n`, `OPENAI_API_KEY=${openai}`)

  const stored = await read("stored-session")
  assert.equal(stored.status, 200)
  const storedBody = (await stored.json()) as OutputResponse
  assert.equal(storedBody.output?.includes(githubPat), false)
  assert.equal(storedBody.output?.includes("p@ssw0rd"), false)
  assert.equal(storedBody.output?.includes("ci-user:"), false)
  assert.equal(storedBody.error?.includes(openai), false)
  assert.match(
    storedBody.output ?? "",
    /https:\/\/\[redacted\]@github.com\/acme\/private.git/
  )
  assert.match(storedBody.error ?? "", /\[redacted\]/)

  const missing = await read("missing-session")
  assert.equal(missing.status, 404)
})

function read(id: string) {
  return GET(new Request("http://127.0.0.1/output"), {
    params: Promise.resolve({ id }),
  })
}
