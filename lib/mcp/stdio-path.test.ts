import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { stdioPathRefusal } from "./stdio-path"

function shellBinary() {
  for (const candidate of ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

test("a path that resolves to a shell is refused, including a hard link", () => {
  const shell = shellBinary()
  assert.ok(shell, "expected a shell binary on this system")
  if (!shell) return

  assert.equal(stdioPathRefusal("npx"), null)
  assert.equal(stdioPathRefusal("/usr/bin/npx-not-installed"), null)
  assert.equal(stdioPathRefusal(shell), null)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-stdio-"))
  try {
    const link = path.join(dir, "npx")
    fs.symlinkSync(shell, link)
    const refusal = stdioPathRefusal(link)
    assert.equal(typeof refusal, "string")
    assert.match(refusal ?? "", /shell/i)
    assert.match(refusal ?? "", /bash|sh/)

    const hard = path.join(dir, "npx-hard")
    try {
      fs.linkSync(shell, hard)
    } catch {
      return
    }
    const hardRefusal = stdioPathRefusal(hard)
    assert.equal(typeof hardRefusal, "string")
    assert.match(hardRefusal ?? "", /shell/i)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
