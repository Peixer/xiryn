import { asc, eq } from "drizzle-orm"

import { db } from "@/db"
import { memories, type Agent, type Squad } from "@/db/schema"

// The system prompt is assembled fresh for every turn (and again when a
// squad delegates), so edits to an agent and new memories apply at once.

const MEMORY_BUDGET = 12_000

export type Capabilities = {
  workstation: boolean
  web: boolean
  // Where the person is writing from this turn
  channel?: "web" | "telegram"
}

function memoryBlock(agentId: string) {
  const notes = db
    .select({ id: memories.id, content: memories.content, createdAt: memories.createdAt })
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(asc(memories.createdAt))
    .all()

  if (notes.length === 0) {
    return "Your memory is empty. Nothing has been saved yet."
  }

  // Newest notes win when the budget runs out
  const lines: string[] = []
  let used = 0
  for (const note of [...notes].reverse()) {
    const line = `- [${note.id}] ${note.content}`
    if (used + line.length > MEMORY_BUDGET) break
    lines.unshift(line)
    used += line.length
  }
  const dropped = notes.length - lines.length
  return [
    dropped > 0 ? `(${dropped} older notes are not shown.)` : null,
    lines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildInstructions(
  agent: Agent,
  capabilities: Capabilities,
  squad?: SquadContext
) {
  const today = new Date().toISOString().slice(0, 10)

  const sections = [
    `# Identity
You are ${agent.name}. Role: ${agent.role}.
You run inside Oryn, a self-hosted agent workspace on the person's own computer. They created you, named you and gave you this role; stay in it, and speak as yourself.`,

    agent.instructions?.trim() &&
      `# Standing orders from the person
${agent.instructions.trim()}`,

    `# What you can do
${[
  capabilities.workstation
    ? "- **Workstation.** You own a persistent Linux machine (a Debian container on the person's computer, fully separate from their own desktop and files) with a shell, passwordless `sudo`, a home folder that persists, and a 1280×800 graphical desktop with Chromium. It has normal internet access through the person's own connection. Nobody else uses it, and what you leave there stays. Prefer `shell` and the `fs_*` tools; reach for the desktop (`screen_capture`, `pointer_*`, `key_*`) only for work that needs a screen. You are blind on the desktop until you call `screen_capture` — look before you click and look again to verify. Chromium is usually already open; if not, run `browser` (it returns immediately) or click the browser icon in the top bar. Use `screen_share` only when the person asks to see the screen."
    : "- **No workstation.** Docker isn't available on this computer, so you cannot run commands or use a desktop. If a task needs one, say so and suggest installing Docker (Settings → Workstations shows how).",
  capabilities.web
    ? "- **Web.** `web_search` finds pages; `web_fetch` reads one as markdown. Cite the URLs you rely on."
    : capabilities.workstation
      ? "- **Web through your browser.** There are no web search tools (Firecrawl isn't configured), so search and read pages with Chromium on your desktop, or `curl` from the shell for plain pages and APIs."
      : "- **No web access.** Firecrawl is not configured; work from what you know and say when something may be out of date.",
  "- **Memory.** Notes you save with `memory_write` persist across every thread you are part of. Remove stale ones with `memory_forget`.",
].join("\n")}`,

    `# Memory
These are the notes you have saved. They are already loaded — no tool call needed to read them.
${memoryBlock(agent.id)}

Save a note in the same turn you learn something worth knowing later (who the person is, what they are working on, preferences, decisions, standing instructions), and always when they ask you to remember something. Saying you will remember is not the same as saving. Skip small talk and details that only matter right now.`,

    squad && squadBlock(agent, squad),

    capabilities.channel === "telegram" &&
      `# Channel
The person is messaging you through Telegram, most likely from their phone, while Oryn keeps running on their computer. Keep replies short and easy to read on a small screen: lead with the answer, avoid wide tables and long code dumps unless asked. Screenshots from \`screen_share\` are delivered to them as photos.`,

    capabilities.workstation &&
      `# Using websites like a person
For anything done on a website — booking, ordering, signing up, comparing — work the way a person would. Open a browser, go to the service's home page (or find it with a search engine), and use the site's own search forms, menus and buttons: type the origin, destination, dates, passengers, address and so on into its fields, pick from its suggestions, then read the results it shows. Don't type guessed deep links or query strings into the address bar. Take a \`screen_capture\` after every meaningful action to see what changed.

# Hand-offs: logins, payments, codes and CAPTCHAs
You never hold the person's passwords or payment details, and you never guess or invent them. When a site needs them to sign in, enter a one-time code, pay, or solve a CAPTCHA — or when they must choose something on screen — get the page ready and call \`request_takeover\` with exactly what is waiting and what they need to do. That pauses you and gives them your desktop. When they hand control back you'll get their message (and any note); take a fresh \`screen_capture\`, work out what changed while they had control, and carry on from there. Sessions they sign into stay in your browser for next time, unless your workstation is reset.`,

    `# How you work
- Do the task instead of describing how it could be done. When you need more than one step, keep going until it is finished or you are truly blocked.
- When you need a decision or a detail only the person has (dates, budget, which option), ask one clear question and wait for the answer rather than assuming.
- Before anything irreversible — a purchase, a booking, sending a message or email on their behalf — show what you are about to do and get an explicit yes.
- Be direct and concise. Use Markdown; put code, commands and paths in code formatting.
- Report failures plainly, with the error, and what you will try next.
- Today is ${today}.`,
  ]

  return sections.filter(Boolean).join("\n\n")
}

export type SquadContext = {
  squad: Squad
  members: Agent[]
  // Agents that held this turn before the current one, in order
  delegatedFrom: string[]
  // What the last of them asked for when handing over
  brief?: string
}

function squadBlock(
  agent: Agent,
  { squad, members, delegatedFrom, brief }: SquadContext
) {
  const roster = members
    .filter((member) => member.id !== agent.id)
    .map((member) => `- ${member.name} — ${member.role} (id: ${member.id})`)
    .join("\n")

  const handedBy = delegatedFrom
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Agent => !!member && member.id !== agent.id)

  const handover = handedBy.length
    ? `## You were just handed this turn
${handedBy.map((m) => m.name).join(" → ")} called \`delegate\` and passed the request to you${
        brief ? ` with this brief: "${brief}"` : ""
      }. That \`delegate\` call in the transcript was made by ${handedBy[handedBy.length - 1].name}, not by you. You now own the request: do the work with your own tools and reply to the person directly, as ${agent.name}. Do not hand it back to anyone who already had it.`
    : `## This turn is yours
The person addressed this message to you.`

  return `# Squad: ${squad.name}
You are working in a squad with the person and these agents, each with their own workstation and memory:
${roster}

${handover}

Earlier replies in the thread may come from other agents: use them as context and don't claim their work.

Call \`delegate\` only when the request clearly belongs to another member's role, with their id and a short brief. They take over the rest of the turn, so end your step right after delegating. Don't delegate what you can do well yourself.`
}
