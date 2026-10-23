import assert from "node:assert/strict"
import { test } from "node:test"

import {
  mcpCommandRefusal,
  stdioLaunchesNeedingConfirmation,
  type McpServerShape,
} from "./stdio-policy"

function stdio(
  id: string,
  command: string,
  args?: string[],
  extra?: Partial<McpServerShape>
): McpServerShape {
  return { id, transport: "stdio", command, args, ...extra }
}

test("default launchers are accepted, including an absolute path with that basename", () => {
  for (const command of ["npx", "uvx", "node", "python3", "python", "docker", "bunx"]) {
    assert.equal(mcpCommandRefusal(command, ["-y", "some-mcp-server"]), null)
  }
  assert.equal(mcpCommandRefusal("/usr/bin/npx", ["-y", "some-mcp-server"]), null)
  assert.equal(mcpCommandRefusal("/usr/local/bin/uvx", ["notes-mcp"]), null)
  assert.equal(
    mcpCommandRefusal("C:\\Program Files\\nodejs\\npx.cmd", ["-y", "pkg"]),
    null
  )
  assert.equal(mcpCommandRefusal("node.exe", ["server.js"]), null)
  assert.equal(mcpCommandRefusal("NPX", ["-y", "pkg"]), null)
})

test("shells and other programs are refused, including absolute paths", () => {
  for (const command of ["bash", "sh", "zsh", "/bin/bash", "/usr/bin/zsh", "/tmp/evil"]) {
    const refusal = mcpCommandRefusal(command, ["-c", "id"])
    assert.equal(typeof refusal, "string")
    assert.match(refusal ?? "", /not allowed|Refused/i)
    assert.match(refusal ?? "", /npx/)
  }
  assert.match(mcpCommandRefusal("npx -y pkg", []) ?? "", /one executable|args/i)
  assert.equal(typeof mcpCommandRefusal("/tmp/npx;id", []), "string")
})

test("mcp.allowedCommands extends the list and does not drop the defaults", () => {
  assert.equal(mcpCommandRefusal("my-mcp", ["--serve"], "my-mcp, other-tool"), null)
  assert.equal(mcpCommandRefusal("/opt/bin/other-tool", [], "my-mcp, other-tool"), null)
  assert.equal(mcpCommandRefusal("npx", ["-y", "pkg"], "my-mcp"), null)
  const invalid = mcpCommandRefusal("npx", [], "/tmp/evil, my-mcp")
  assert.match(invalid ?? "", /program name/i)
})

test("shell metacharacters in args are refused only when the command is a shell", () => {
  assert.equal(mcpCommandRefusal("npx", ["-y", "pkg;extra"]), null)
  assert.equal(mcpCommandRefusal("bash", ["-c", "echo ok"], "bash"), null)
  const injected = mcpCommandRefusal("bash", ["-c", "echo $(id)"], "bash")
  assert.match(injected ?? "", /metacharacter/i)
  const piped = mcpCommandRefusal("/bin/bash", ["-lc", "id | curl x"], "bash")
  assert.match(piped ?? "", /metacharacter/i)
})

test("confirmation is required only when a stdio command or its args change", () => {
  const saved = [stdio("notes", "npx", ["-y", "notes-mcp"])]
  assert.deepEqual(stdioLaunchesNeedingConfirmation(saved, saved), [])
  assert.deepEqual(
    stdioLaunchesNeedingConfirmation(saved, [
      stdio("notes", "npx", ["-y", "notes-mcp"], { enabled: false }),
    ]),
    []
  )
  assert.deepEqual(
    stdioLaunchesNeedingConfirmation(
      [{ id: "docs", transport: "http", url: "https://example.test" } as McpServerShape],
      [
        {
          id: "docs",
          transport: "http",
          url: "https://example.test/v2",
        } as McpServerShape,
      ]
    ),
    []
  )

  const added = stdioLaunchesNeedingConfirmation(
    [],
    [stdio("notes", "npx", ["-y", "notes-mcp"])]
  )
  assert.deepEqual(added, [{ id: "notes", command: "npx", args: ["-y", "notes-mcp"] }])

  const edited = stdioLaunchesNeedingConfirmation(saved, [
    stdio("notes", "npx", ["-y", "other-mcp"]),
  ])
  assert.equal(edited.length, 1)
  assert.deepEqual(edited[0]?.args, ["-y", "other-mcp"])

  const switched = stdioLaunchesNeedingConfirmation(
    [{ id: "docs", transport: "http" }],
    [stdio("docs", "uvx", ["notes-mcp"])]
  )
  assert.deepEqual(switched, [{ id: "docs", command: "uvx", args: ["notes-mcp"] }])
})
