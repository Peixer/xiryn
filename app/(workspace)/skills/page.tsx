import type { Metadata } from "next"

import { SkillsView } from "@/components/skills/skills-view"
import { SKILL_CATALOG_LIMIT, SKILL_MAX_COUNT } from "@/lib/skills"
import { getSkills } from "@/queries/skills"

export const metadata: Metadata = { title: "Skills" }

export default function Page() {
  const { skills, warnings } = getSkills()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="label-mono">{`// skills · ${skills.length}`}</span>
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Playbooks an agent can read when a task needs them: how you want invoices
            filed, how a brief is shaped, a checklist you don&apos;t want to retype. They
            live as files in{" "}
            <code className="rounded-sm bg-muted px-1 font-mono text-[11.5px] text-foreground">
              data/skills
            </code>{" "}
            on this computer. The next message sees a short catalog (name and description,
            up to {SKILL_CATALOG_LIMIT}). The agent loads the full text with{" "}
            <code className="rounded-sm bg-muted px-1 font-mono text-[11.5px] text-foreground">
              skill_read
            </code>
            . It cannot create or edit skills.
          </p>
        </header>
        <div className="flex flex-col gap-1.5 rounded-xl border border-dashed px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="label-mono">{"// prompt text, not a program"}</span>
          <p>
            A skill is instructions. Read the playbook below before you rely on it — that
            is the text an agent will follow. Xiryn does not run a script because a skill
            mentions one. The library holds {SKILL_MAX_COUNT} skills, each 16 KB or
            smaller. A file that isn&apos;t valid is skipped and listed here; it is not
            sent to the model.
          </p>
        </div>
        <SkillsView skills={skills} warnings={warnings} />
      </div>
    </div>
  )
}
