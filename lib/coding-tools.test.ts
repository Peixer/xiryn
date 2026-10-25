import assert from "node:assert/strict"
import { test } from "node:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { codingAccess, codingVolumeArgs } from "./coding-tools"

test("coding credentials are opt-in, writable only by Coder, and never bind host paths", () => {
  assert.deepEqual(codingVolumeArgs({ name: "Coder", codingTools: false }), [])
  for (const name of ["Coder", " coder ", "Researcher"]) {
    const agent = { name, codingTools: true }
    const access = name.trim().toLowerCase() === "coder" ? "rw" : "ro"
    assert.equal(codingAccess(agent), access)
    assert.deepEqual(codingVolumeArgs(agent), [
      "--volume",
      `xiryn-coding-creds:/home/xiryn/.coding-creds:${access}`,
      "--env",
      "XIRYN_CODING_TOOLS=1",
    ])
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
