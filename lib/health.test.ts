import assert from "node:assert/strict"
import { test } from "node:test"

import { buildHealth, type HealthSnapshot } from "./health"

const NEXT_RUN = new Date("2026-10-24T09:00:00.000Z")

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    version: "0.5.1",
    uptimeSeconds: 42,
    dbOk: true,
    docker: "ready",
    routines: { enabled: 2, nextRunAt: NEXT_RUN },
    telegramConfigured: false,
    providersConfigured: 1,
    ...overrides,
  }
}

test("buildHealth maps a snapshot to status and HTTP code", () => {
  const cases: {
    dbOk: boolean
    docker: HealthSnapshot["docker"]
    status: "ok" | "degraded" | "down"
    httpStatus: 200 | 503
  }[] = [
    { dbOk: true, docker: "ready", status: "ok", httpStatus: 200 },
    { dbOk: true, docker: "stopped", status: "degraded", httpStatus: 200 },
    { dbOk: true, docker: "missing", status: "degraded", httpStatus: 200 },
    { dbOk: true, docker: "unknown", status: "degraded", httpStatus: 200 },
    { dbOk: false, docker: "ready", status: "down", httpStatus: 503 },
    { dbOk: false, docker: "stopped", status: "down", httpStatus: 503 },
    { dbOk: false, docker: "missing", status: "down", httpStatus: 503 },
    { dbOk: false, docker: "unknown", status: "down", httpStatus: 503 },
  ]

  for (const entry of cases) {
    const report = buildHealth(snapshot({ dbOk: entry.dbOk, docker: entry.docker }))
    assert.equal(report.body.status, entry.status, entry.docker)
    assert.equal(report.httpStatus, entry.httpStatus, entry.docker)
    assert.equal(report.body.db.ok, entry.dbOk)
    assert.equal(report.body.docker, entry.docker)
  }
})

test("an unknown docker state is degraded and does not throw", () => {
  const report = buildHealth(snapshot({ docker: "unknown" }))
  assert.equal(report.body.status, "degraded")
  assert.equal(report.body.docker, "unknown")
  assert.equal(report.httpStatus, 200)

  const weird = buildHealth(
    snapshot({ docker: "not-a-state" as HealthSnapshot["docker"] })
  )
  assert.equal(weird.body.status, "degraded")
  assert.equal(weird.body.docker, "unknown")
  assert.equal(weird.httpStatus, 200)
})

test("a healthy snapshot keeps the public fields and drops everything else", () => {
  const report = buildHealth(
    snapshot({ telegramConfigured: true, providersConfigured: 3 })
  )
  assert.deepEqual(report.body, {
    status: "ok",
    version: "0.5.1",
    uptimeSeconds: 42,
    db: { ok: true },
    docker: "ready",
    routines: { enabled: 2, nextRunAt: "2026-10-24T09:00:00.000Z" },
    telegram: "configured",
    providersConfigured: 3,
  })
  assert.equal(report.httpStatus, 200)

  const idle = buildHealth(
    snapshot({
      telegramConfigured: false,
      routines: { enabled: 0, nextRunAt: null },
    })
  )
  assert.equal(idle.body.telegram, "off")
  assert.deepEqual(idle.body.routines, { enabled: 0, nextRunAt: null })
})

test("buildHealth output contains none of the secret setting values", () => {
  const secrets = {
    "telegram.botToken": "123456789:AAHsecret-token-value",
    "provider.openai.apiKey": "sk-live-openai-secret-value",
    "firecrawl.apiKey": "fc-secret-firecrawl-key",
    "provider.bedrock.secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYSECRET",
    "provider.bedrock.accessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "google.clientSecret": "google-oauth-client-secret-value",
    "google.refreshToken": "1//refresh-token-secret-value",
  }
  const report = buildHealth({ ...snapshot(), ...secrets })
  const encoded = JSON.stringify(report)
  for (const value of Object.values(secrets)) {
    assert.equal(encoded.includes(value), false, value)
  }
  assert.deepEqual(Object.keys(report.body).sort(), [
    "db",
    "docker",
    "providersConfigured",
    "routines",
    "status",
    "telegram",
    "uptimeSeconds",
    "version",
  ])
})
