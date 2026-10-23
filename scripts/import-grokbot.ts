import fs from "node:fs"

import { db } from "@/db"
import { agents } from "@/db/schema"
import { parseAllowlist } from "@/lib/agent/untrusted"
import { getSetting } from "@/lib/config"
import { applyGrokbotPlan, GrokbotApplyError } from "@/lib/grokbot-apply"
import { parseGrokbotCli } from "@/lib/grokbot-cli"
import { fetchGrokbotShare } from "@/lib/grokbot-fetch"
import {
  GROKBOT_MAX_BYTES,
  GROKBOT_SCHEME_ERROR,
  classifyGrokbotInput,
  parseGrokbotDocument,
  parseGrokbotValue,
  type GrokbotImportPlan,
} from "@/lib/grokbot-import"
import { SKILL_MAX_COUNT, listSkills } from "@/lib/skills"

// npx tsx scripts/import-grokbot.ts <file.json | https://share-link | -> [--dry-run]
// Prints a plan with --dry-run. Without it, writes the agent. Routines stay off.

function context() {
  const skills = listSkills()
  return {
    takenNames: db
      .select({ name: agents.name })
      .from(agents)
      .all()
      .map((row) => row.name),
    takenSlugs: skills.skills.map((skill) => skill.slug),
    skillRoom: Math.max(0, SKILL_MAX_COUNT - skills.skills.length),
  }
}

function readStdin() {
  return fs.readFileSync(0, "utf8")
}

function summarize(plan: GrokbotImportPlan, host: string | null) {
  const lines = [
    host ? `Host: ${host}` : "Source: pasted JSON",
    `Agent: ${plan.agent.name}${plan.agent.renamedFrom ? ` (renamed from ${plan.agent.renamedFrom})` : ""}`,
    `Role: ${plan.agent.role}`,
    `Memories: ${plan.memories.length}`,
    `Skills: ${plan.skills.map((skill) => skill.slug).join(", ") || "none"}`,
    `Routines: ${plan.routines.length} (all left off)`,
    `Connectors to set up: ${plan.connectors.map((item) => item.name).join(", ") || "none"}`,
    plan.onboardingSkill
      ? `Getting started: ${plan.onboardingSkill} (saved, not run)`
      : "Getting started: none",
  ]
  for (const routine of plan.routines) {
    const when = routine.schedule ? JSON.stringify(routine.schedule) : "no schedule"
    lines.push(`  routine ${routine.name}: ${when}`)
    for (const flag of routine.flags) lines.push(`    ${flag}`)
  }
  for (const connector of plan.connectors) {
    lines.push(`  connector ${connector.name}: ${connector.setup}`)
  }
  if (plan.warnings.length > 0) {
    lines.push("Warnings:")
    for (const warning of plan.warnings) lines.push(`  ${warning}`)
  }
  return lines.join("\n")
}

async function main() {
  const args = parseGrokbotCli(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.error)
    process.exitCode = 1
    return
  }
  const raw = args.stdin ? readStdin() : args.source
  const kind = classifyGrokbotInput(raw)
  if (kind.kind === "grokbot-scheme") {
    console.error(GROKBOT_SCHEME_ERROR)
    process.exitCode = 1
    return
  }

  let plan: GrokbotImportPlan
  let host: string | null = null
  if (kind.kind === "url") {
    const fetched = await fetchGrokbotShare(kind.url, {
      allowHosts: parseAllowlist(getSetting("grokbot.importHosts")),
    })
    if (!fetched.ok) {
      console.error(fetched.error)
      process.exitCode = 1
      return
    }
    host = fetched.host
    const parsed = parseGrokbotValue(fetched.value, context())
    if (!parsed.ok) {
      console.error(parsed.error)
      process.exitCode = 1
      return
    }
    plan = parsed.plan
  } else {
    const fromFile = kind.kind !== "json" && raw !== "" && fs.existsSync(raw)
    const text = kind.kind === "json" ? raw : fromFile ? fs.readFileSync(raw, "utf8") : ""
    if (!text.trim()) {
      console.error(
        fromFile
          ? "That file is empty."
          : kind.kind === "rejected" && !/^[a-z][a-z0-9+.-]*:/i.test(raw)
            ? `No file at ${raw}.`
            : kind.kind === "rejected"
              ? kind.error
              : "Paste a template or a share link."
      )
      process.exitCode = 1
      return
    }
    if (new TextEncoder().encode(text).byteLength > GROKBOT_MAX_BYTES) {
      console.error("That file is larger than 2 MB.")
      process.exitCode = 1
      return
    }
    const parsed = parseGrokbotDocument(text, context())
    if (!parsed.ok) {
      console.error(parsed.error)
      process.exitCode = 1
      return
    }
    plan = parsed.plan
  }

  console.log(summarize(plan, host))
  if (args.dryRun) {
    console.log("\nDry run. Nothing was written.")
    return
  }
  try {
    const result = applyGrokbotPlan(plan)
    console.log(`\nCreated ${result.agent.name}. Routines are off.`)
  } catch (error) {
    console.error(
      error instanceof GrokbotApplyError ? error.message : "Couldn't import that agent."
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.name : "Couldn't import that agent.")
  process.exitCode = 1
})
