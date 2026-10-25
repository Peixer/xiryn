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
      '#!/bin/bash\nset -e\necho install >> "$HOME/installs"\nif [[ "$*" == *anthropic* ]]; then mkdir -p "$HOME/.local/bin"; printf "#!/bin/sh\\n" > "$HOME/.local/bin/claude"; chmod +x "$HOME/.local/bin/claude"; exit 0; fi\nmkdir -p "$HOME/codex-cli/node_modules/.bin"\nprintf "#!/bin/sh\\n" > "$HOME/codex-cli/node_modules/.bin/codex"\nchmod +x "$HOME/codex-cli/node_modules/.bin/codex"\n',
      { mode: 0o755 }
    )
    const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` }
    for (let i = 0; i < 2; i++)
      execFileSync("bash", ["scripts/setup-coding-tools.sh"], { env })
    assert.equal(
      fs.readFileSync(path.join(root, "installs"), "utf8"),
      "install\ninstall\n"
    )
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

// Helper used by the git-credentials tests below
function makeCredsEnv(
  root: string,
  creds: string
): { env: NodeJS.ProcessEnv; script: string } {
  const bin = path.join(root, "bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(creds, { recursive: true })
  // Minimal fake npm that satisfies the codex install check
  fs.writeFileSync(
    path.join(bin, "npm"),
    '#!/bin/bash\nmkdir -p "$HOME/codex-cli/node_modules/.bin"\nprintf "#!/bin/sh\\n" > "$HOME/codex-cli/node_modules/.bin/codex"\nchmod +x "$HOME/codex-cli/node_modules/.bin/codex"\n',
    { mode: 0o755 }
  )
  // Patch the CREDS path in the script so it points to our temp dir
  const src = fs
    .readFileSync("scripts/setup-coding-tools.sh", "utf8")
    .replace("/home/xiryn/.coding-creds", creds)
  const script = path.join(root, "setup.sh")
  fs.writeFileSync(script, src, { mode: 0o755 })
  const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH ?? ""}` }
  return { env, script }
}

test("setup-coding-tools: links credentials when .git-credentials is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-missing-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(
      out.includes("linked from volume"),
      `expected 'linked from volume' in: ${out}`
    )
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
    assert.equal(
      fs.readlinkSync(path.join(root, ".git-credentials")),
      path.join(creds, ".git-credentials")
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("setup-coding-tools: skips when .git-credentials is already a symlink (idempotent)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-linked-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    fs.symlinkSync(
      path.join(creds, ".git-credentials"),
      path.join(root, ".git-credentials")
    )
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(out.includes("already linked"), `expected 'already linked' in: ${out}`)
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("setup-coding-tools: replaces empty .git-credentials file with symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-empty-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    fs.writeFileSync(path.join(root, ".git-credentials"), "") // empty regular file
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(
      out.includes("replaced empty file"),
      `expected 'replaced empty file' in: ${out}`
    )
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("setup-coding-tools: backs up non-empty stale file then symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-stale-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    const stale = "https://old:oldtoken@github.com\n"
    fs.writeFileSync(path.join(root, ".git-credentials"), stale) // non-empty stale
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(
      out.includes("backed up stale file"),
      `expected 'backed up stale file' in: ${out}`
    )
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
    assert.ok(fs.existsSync(path.join(root, ".git-credentials.bak")), "backup must exist")
    assert.equal(fs.readFileSync(path.join(root, ".git-credentials.bak"), "utf8"), stale)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
