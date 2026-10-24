// Drizzle applies a migration only when its journal `when` is greater than
// the newest `__drizzle_migrations.created_at`. Production already recorded
// 0008 at this watermark. Anything that is not already on that database has
// to sort after it, or the migrator skips it and every later file too.

export const PRODUCTION_APPLIED_WATERMARK = 1_792_789_000_000

// Tags whose SQL already ran on the production database. 0008's file hash
// matches that deploy; its journal `when` in git is older than the watermark
// because a later commit rewrote it. Do not add tags here for migrations
// that production has not applied.
export const DEPLOYED_MIGRATION_TAGS = [
  "0000_init",
  "0001_vault",
  "0002_turn_cost",
  "0003_routines",
  "0004_vengeful_freak",
  "0005_shared_memory",
  "0006_approval_args_hash",
  "0007_grokbot_routine_schedule",
  "0008_subagent_threads",
] as const

// sha256 of the 0008 SQL that production applied (`DEFAULT false`, not `0`).
export const DEPLOYED_0008_SHA256 =
  "c13f5a714857b54b448950ad593549f3d327a7973b8926f2bd02efca6efb1944"

export type JournalEntry = { tag: string; when: number; idx?: number }

export function journalProblems(
  entries: JournalEntry[],
  watermark = PRODUCTION_APPLIED_WATERMARK
): string[] {
  const problems: string[] = []
  const deployed = new Set<string>(DEPLOYED_MIGRATION_TAGS)
  let previous = -1
  for (const entry of entries) {
    if (!Number.isInteger(entry.when)) {
      problems.push(`${entry.tag} has a non-integer when`)
      continue
    }
    if (entry.when <= previous) {
      problems.push(`${entry.tag} when ${entry.when} is not strictly after ${previous}`)
    }
    previous = entry.when
    if (!deployed.has(entry.tag) && entry.when <= watermark) {
      problems.push(
        `${entry.tag} when ${entry.when} is not newer than the applied watermark ${watermark}`
      )
    }
  }
  return problems
}

// The migrator's own rule: a row is applied only when folderMillis is
// greater than the last stored created_at. Equal does not re-run.
export function drizzleWouldApply(input: {
  when: number
  lastAppliedWhen: number | null
}) {
  if (input.lastAppliedWhen === null) return true
  return input.lastAppliedWhen < input.when
}

export function migrationGap(input: {
  journalCount: number
  appliedCount: number
}): { ok: true } | { ok: false; skipped: number; reason: string } {
  const { journalCount, appliedCount } = input
  if (!Number.isInteger(journalCount) || journalCount < 0) {
    return { ok: false, skipped: 0, reason: "The migration journal could not be read." }
  }
  if (!Number.isInteger(appliedCount) || appliedCount < 0) {
    return {
      ok: false,
      skipped: 0,
      reason: "The applied migration count could not be read.",
    }
  }
  if (appliedCount < journalCount) {
    const skipped = journalCount - appliedCount
    return {
      ok: false,
      skipped,
      reason: `${skipped} migration${skipped === 1 ? "" : "s"} in the journal did not apply. Refusing to switch.`,
    }
  }
  return { ok: true }
}
