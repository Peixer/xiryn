import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"

import * as workstationImage from "./workstation-image"

const readOnly = new Error(
  "failed to build: failed to update builder last activity time: open /home/xiryn/.docker/buildx/activity/.tmp-default2921179012: read-only file system"
)

test("a read-only buildx home tells the operator how to fix it without stopping the app", () => {
  const describeWorkstationBuildFailure = workstationImage.describeWorkstationBuildFailure
  assert.equal(typeof describeWorkstationBuildFailure, "function")
  const message = describeWorkstationBuildFailure(readOnly)
  assert.match(message, /keep serving/)
  assert.match(message, /BUILDX_CONFIG/)
  assert.match(message, /\/var\/lib\/xiryn\/docker\/buildx/)
  assert.match(message, /20-docker-config\.conf/)
  assert.match(message, /read-only file system/)
})

test("other workstation build failures stay actionable and do not blame the home sandbox", () => {
  const describeWorkstationBuildFailure = workstationImage.describeWorkstationBuildFailure
  assert.equal(typeof describeWorkstationBuildFailure, "function")
  const message = describeWorkstationBuildFailure(new Error("docker build exited with 1"))
  assert.match(message, /keep serving/)
  assert.match(message, /docker build exited with 1/)
  assert.match(message, /Settings/)
  assert.doesNotMatch(message, /20-docker-config\.conf/)
  assert.doesNotMatch(message, /BUILDX_CONFIG/)
})

test("a workstation build started in the background cannot reject the caller", async () => {
  const lines: string[] = []
  const original = console.error
  console.error = (line?: unknown) => {
    lines.push(String(line))
  }
  try {
    const logWorkstationBuildFailure = workstationImage.logWorkstationBuildFailure
    const observeWorkstationBuild = workstationImage.observeWorkstationBuild
    assert.equal(typeof logWorkstationBuildFailure, "function")
    assert.equal(typeof observeWorkstationBuild, "function")
    logWorkstationBuildFailure(readOnly)
    // The build promise already logged. Containing it must not log again.
    await observeWorkstationBuild(Promise.reject(readOnly))
  } finally {
    console.error = original
  }
  assert.equal(lines.length, 1)
  assert.match(lines[0], /\[xiryn\]/)
  assert.match(lines[0], /keep serving/)
  assert.match(lines[0], /read-only file system/)
})

test("startup and settings observe the build, and a failed build is recorded before it rejects", () => {
  const image = fs.readFileSync("lib/workstation-image.ts", "utf8")
  assert.match(image, /logWorkstationBuildFailure\(error\)/)
  const startup = fs.readFileSync("instrumentation.ts", "utf8")
  assert.match(startup, /observeWorkstationBuild\(/)
  const action = fs.readFileSync("actions/workstation.ts", "utf8")
  assert.match(action, /observeWorkstationBuild\(buildImage\(\)\)/)
  const home = fs.readFileSync("app/(workspace)/page.tsx", "utf8")
  assert.doesNotMatch(home, /ensureImage|buildImage|getImageState/)
  const root = fs.readFileSync("app/layout.tsx", "utf8")
  assert.doesNotMatch(root, /ensureImage|buildImage|getImageState/)
})
