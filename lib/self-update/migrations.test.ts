import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  DEPLOYED_0008_SHA256,
  drizzleWouldApply,
  journalProblems,
  migrationGap,
  PRODUCTION_APPLIED_WATERMARK,
} from "./migrations"

const journalPath = path.join(
  import.meta.dirname,
  "../../db/migrations/meta/_journal.json"
)
const sql0008 = path.join(
  import.meta.dirname,
  "../../db/migrations/0008_subagent_threads.sql"
)

test("journal whens increase and new migrations sort after the production watermark", () => {
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[]
  }
  assert.deepEqual(journalProblems(journal.entries), [])
  const last = journal.entries.find((entry) => entry.tag === "0009_subturn_fk_schema_fix")
  assert.ok(last)
  assert.ok(last.when > PRODUCTION_APPLIED_WATERMARK)
  assert.equal(
    drizzleWouldApply({ when: last.when, lastAppliedWhen: PRODUCTION_APPLIED_WATERMARK }),
    true
  )
  assert.equal(
    drizzleWouldApply({
      when: 1_792_784_564_728,
      lastAppliedWhen: PRODUCTION_APPLIED_WATERMARK,
    }),
    false
  )
})

test("0008 matches the SQL production already applied", () => {
  const hash = createHash("sha256").update(fs.readFileSync(sql0008)).digest("hex")
  assert.equal(hash, DEPLOYED_0008_SHA256)
  assert.match(fs.readFileSync(sql0008, "utf8"), /DEFAULT false NOT NULL/)
})

test("a switch is refused when applied migrations are behind the journal", () => {
  const gap = migrationGap({ journalCount: 10, appliedCount: 9 })
  assert.equal(gap.ok, false)
  if (!gap.ok) assert.equal(gap.skipped, 1)
  assert.equal(migrationGap({ journalCount: 10, appliedCount: 10 }).ok, true)
  assert.equal(migrationGap({ journalCount: 10, appliedCount: 11 }).ok, true)
})
