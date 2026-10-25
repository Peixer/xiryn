import assert from "node:assert/strict"
import { test } from "node:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("credential ownership follows category and insertion order, never agent names", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-category-"))
  process.env.XIRYN_DATA_DIR = root
  const { codingAccess, codingVolumeArgs } = await import("./coding-tools")
  const { db, sqlite } = await import("../db")
  const { agents } = await import("../db/schema")
  const { eq } = await import("drizzle-orm")
  try {
    const createdAt = new Date(1000)
    db.insert(agents)
      .values([
        { id: "general", name: "Coder", role: "test", category: "general", createdAt },
        { id: "owner", name: "Anything", role: "test", category: "coding", createdAt },
        { id: "other", name: "Coder", role: "test", category: "coding", createdAt },
      ])
      .run()
    assert.deepEqual(codingVolumeArgs({ id: "general", category: "general" }), [])
    assert.equal(codingAccess({ id: "owner", category: "coding" }), "rw")
    assert.equal(codingAccess({ id: "other", category: "coding" }), "ro")
    db.update(agents).set({ name: "Coder" }).where(eq(agents.id, "owner")).run()
    assert.equal(codingAccess({ id: "other", category: "coding" }), "ro")
    assert.deepEqual(codingVolumeArgs({ id: "owner", category: "coding" }), [
      "--volume",
      "xiryn-coding-creds:/home/xiryn/.coding-creds:rw",
      "--env",
      "XIRYN_CODING_TOOLS=1",
    ])
  } finally {
    sqlite.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("coding setup is idempotent and retries an incomplete npm install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-coding-"))
  try {
    const bin = path.join(root, "bin")
    fs.mkdirSync(bin)
    fs.mkdirSync(path.join(root, "codex-cli")) // interrupted previous install
    fs.writeFileSync(
      path.join(bin, "npm"),
      '#!/bin/bash\nset -e\necho install >> "$HOME/installs"\nmkdir -p "$HOME/codex-cli/node_modules/.bin"\nprintf "#!/bin/sh\\n" > "$HOME/codex-cli/node_modules/.bin/codex"\nchmod +x "$HOME/codex-cli/node_modules/.bin/codex"\n',
      { mode: 0o755 }
    )
    const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` }
    for (let i = 0; i < 2; i++)
      execFileSync("bash", ["scripts/setup-coding-tools.sh"], { env })
    assert.equal(fs.readFileSync(path.join(root, "installs"), "utf8"), "install\n")
    assert.ok(fs.lstatSync(path.join(root, ".local/bin/codex")).isSymbolicLink())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("category migration preserves existing coding opt-in and legacy column", async () => {
  const { default: Database } = await import("better-sqlite3")
  const sqlite = new Database(":memory:")
  try {
    sqlite.exec("CREATE TABLE agents (id text, coding_tools integer NOT NULL DEFAULT 0)")
    sqlite.exec("INSERT INTO agents VALUES ('coding', 1), ('general', 0)")
    sqlite.exec(fs.readFileSync("db/migrations/0011_agent_category.sql", "utf8"))
    assert.deepEqual(sqlite.prepare("SELECT * FROM agents ORDER BY id").all(), [
      { id: "coding", coding_tools: 1, category: "coding" },
      { id: "general", coding_tools: 0, category: "general" },
    ])
  } finally {
    sqlite.close()
  }
})
