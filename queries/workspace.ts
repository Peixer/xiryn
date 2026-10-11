import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm"

import { db, DB_PATH } from "@/db"
import {
  agents,
  memories,
  messages,
  squadMembers,
  squads,
  threads,
  turns,
} from "@/db/schema"
import { activeThreadIds, loadMessages } from "@/lib/agent/runtime"
import { describeSetting, getSetting } from "@/lib/config"
import { providers } from "@/lib/providers/catalog"
import { configuredProviders, resolveModelSpec } from "@/lib/providers/registry"
import { engineSnapshot } from "@/lib/docker"
import { isWebConfigured } from "@/lib/web"
import { isWorkstationConfigured } from "@/lib/workstation"
import { version } from "@/package.json"

/* ───────────────────────────── sidebar ──────────────────────────── */

export function getAgents() {
  return db.select().from(agents).orderBy(asc(agents.createdAt)).all()
}

export function getSquads() {
  return db.query.squads
    .findMany({
      orderBy: asc(squads.createdAt),
      with: {
        members: { orderBy: asc(squadMembers.position), with: { agent: true } },
      },
    })
    .sync()
    .map(({ members, ...squad }) => ({ ...squad, agents: members.map((m) => m.agent) }))
}

export type SquadWithAgents = ReturnType<typeof getSquads>[number]

export function getRecentThreads(limit = 40) {
  return db.query.threads
    .findMany({
      orderBy: desc(threads.activeAt),
      limit,
      with: {
        agent: true,
        squad: {
          with: {
            members: { orderBy: asc(squadMembers.position), with: { agent: true } },
          },
        },
      },
    })
    .sync()
}

export type RecentThread = ReturnType<typeof getRecentThreads>[number]

// Everything the shell needs: who exists, where their latest thread is,
// and which of them are working right now
export function getNavigation() {
  const agentRows = getAgents()
  const squadRows = getSquads()
  const threadRows = db
    .select({
      id: threads.id,
      agentId: threads.agentId,
      squadId: threads.squadId,
      title: threads.title,
      preview: threads.preview,
      activeAt: threads.activeAt,
    })
    .from(threads)
    .orderBy(desc(threads.activeAt))
    .all()

  const running = new Set(activeThreadIds())
  const latest = new Map<string, string>()
  const busy = new Set<string>()
  for (const thread of threadRows) {
    const owner = thread.agentId ?? thread.squadId
    if (!owner) continue
    if (!latest.has(owner)) latest.set(owner, thread.id)
    if (running.has(thread.id)) busy.add(owner)
  }

  return {
    agents: agentRows.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      glyph: agent.glyph,
      model: agent.model,
      instructions: agent.instructions,
      latestThreadId: latest.get(agent.id) ?? null,
      busy: busy.has(agent.id),
    })),
    squads: squadRows.map((squad) => ({
      id: squad.id,
      name: squad.name,
      agentIds: squad.agents.map((agent) => agent.id),
      glyphs: squad.agents.map((agent) => agent.glyph),
      latestThreadId: latest.get(squad.id) ?? null,
      busy: busy.has(squad.id),
    })),
    threads: threadRows.slice(0, 60).map((thread) => ({
      ...thread,
      activeAt: thread.activeAt.toISOString(),
      busy: running.has(thread.id),
    })),
  }
}

export type Navigation = ReturnType<typeof getNavigation>
export type NavAgent = Navigation["agents"][number]
export type NavSquad = Navigation["squads"][number]
export type NavThread = Navigation["threads"][number]

/* ───────────────────────────── threads ──────────────────────────── */

export function getThread(threadId: string) {
  const thread = db.query.threads
    .findFirst({
      where: eq(threads.id, threadId),
      with: {
        agent: true,
        squad: {
          with: {
            members: { orderBy: asc(squadMembers.position), with: { agent: true } },
          },
        },
      },
    })
    .sync()
  if (!thread) return null
  const members = thread.squad
    ? thread.squad.members.map((m) => m.agent)
    : thread.agent
      ? [thread.agent]
      : []
  if (members.length === 0) return null
  return { ...thread, members, messages: loadMessages(threadId) }
}

export type ThreadView = NonNullable<ReturnType<typeof getThread>>

export function getThreadsFor(owner: { agentId?: string; squadId?: string }) {
  const where = owner.agentId
    ? eq(threads.agentId, owner.agentId)
    : eq(threads.squadId, owner.squadId ?? "")
  return db
    .select({
      id: threads.id,
      title: threads.title,
      preview: threads.preview,
      activeAt: threads.activeAt,
    })
    .from(threads)
    .where(where)
    .orderBy(desc(threads.activeAt))
    .limit(50)
    .all()
}

export function getLatestThreadId(owner: { agentId?: string; squadId?: string }) {
  return getThreadsFor(owner)[0]?.id ?? null
}

export function getMemories(agentId: string) {
  return db
    .select()
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(desc(memories.createdAt))
    .all()
}

/* ───────────────────────────── system ───────────────────────────── */

export function getSystemStatus() {
  const configured = configuredProviders().map((p) => p.id)
  const defaultModel = resolveModelSpec(null)
  return {
    version,
    // Filled in per request by the layout
    host: null as string | null,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    dbPath: DB_PATH,
    providers: configured,
    defaultModel,
    defaultModelSource: describeSetting("model.default").source,
    workstation: isWorkstationConfigured(),
    // missing · stopped · ready (null until Docker has been looked at once)
    docker: engineSnapshot()?.state ?? null,
    web: isWebConfigured(),
    ready: !!defaultModel && configured.length > 0,
    running: activeThreadIds(),
    providerOptions: providers.map((p) => ({
      id: p.id,
      name: p.name,
      local: !!p.local,
      configured: configured.includes(p.id),
      suggested: p.suggested,
    })),
  }
}

export type SystemStatus = ReturnType<typeof getSystemStatus>

export function getSettingsView() {
  return {
    providers: providers.map((p) => ({
      ...p,
      apiKey: describeSetting(`provider.${p.id}.apiKey`),
      baseUrl: describeSetting(`provider.${p.id}.baseUrl`),
    })),
    defaultModel: describeSetting("model.default"),
    resolvedDefaultModel: resolveModelSpec(null),
    maxSteps: describeSetting("agent.maxSteps"),
    workstation: {
      cpus: describeSetting("workstation.cpus"),
      memory: describeSetting("workstation.memory"),
      autoStop: describeSetting("workstation.autoStop"),
      autoDelete: describeSetting("workstation.autoDelete"),
      phoneLinks: describeSetting("workstation.phoneLinks"),
    },
    firecrawl: {
      apiKey: describeSetting("firecrawl.apiKey"),
      apiUrl: describeSetting("firecrawl.apiUrl"),
    },
    dbPath: DB_PATH,
    allowedHosts: process.env.ORYN_ALLOWED_HOSTS ?? null,
    counts: {
      agents: db.$count(agents),
      squads: db.$count(squads),
      threads: db.$count(threads),
      messages: db.$count(messages),
      memories: db.$count(memories),
    },
    maxStepsValue: getSetting("agent.maxSteps"),
  }
}

export type SettingsData = ReturnType<typeof getSettingsView>

/* ────────────────────────────── ledger ──────────────────────────── */

export function getUsage(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const window = gte(turns.createdAt, since)

  const totals = db
    .select({
      turns: sql<number>`count(*)`,
      input: sql<number>`coalesce(sum(${turns.inputTokens}), 0)`,
      output: sql<number>`coalesce(sum(${turns.outputTokens}), 0)`,
      reasoning: sql<number>`coalesce(sum(${turns.reasoningTokens}), 0)`,
      cached: sql<number>`coalesce(sum(${turns.cachedTokens}), 0)`,
      toolCalls: sql<number>`coalesce(sum(${turns.toolCalls}), 0)`,
      durationMs: sql<number>`coalesce(sum(${turns.durationMs}), 0)`,
      failed: sql<number>`coalesce(sum(case when ${turns.status} = 'failed' then 1 else 0 end), 0)`,
    })
    .from(turns)
    .where(window)
    .get()!

  const byModel = db
    .select({
      model: turns.model,
      turns: sql<number>`count(*)`,
      input: sql<number>`sum(${turns.inputTokens})`,
      output: sql<number>`sum(${turns.outputTokens})`,
    })
    .from(turns)
    .where(window)
    .groupBy(turns.model)
    .orderBy(desc(sql`sum(${turns.inputTokens}) + sum(${turns.outputTokens})`))
    .all()

  const byAgent = db
    .select({
      agentId: turns.agentId,
      name: agents.name,
      glyph: agents.glyph,
      turns: sql<number>`count(*)`,
      input: sql<number>`sum(${turns.inputTokens})`,
      output: sql<number>`sum(${turns.outputTokens})`,
      toolCalls: sql<number>`sum(${turns.toolCalls})`,
    })
    .from(turns)
    .leftJoin(agents, eq(turns.agentId, agents.id))
    .where(and(window, isNotNull(turns.agentId)))
    .groupBy(turns.agentId)
    .orderBy(desc(sql`sum(${turns.inputTokens}) + sum(${turns.outputTokens})`))
    .all()

  // Day buckets in local time, oldest first
  const daily = db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${turns.createdAt} / 1000, 'unixepoch', 'localtime')`,
      tokens: sql<number>`sum(${turns.inputTokens} + ${turns.outputTokens})`,
      turns: sql<number>`count(*)`,
    })
    .from(turns)
    .where(window)
    .groupBy(sql`1`)
    .orderBy(sql`1`)
    .all()

  const recent = db
    .select({
      id: turns.id,
      model: turns.model,
      status: turns.status,
      input: turns.inputTokens,
      output: turns.outputTokens,
      steps: turns.steps,
      toolCalls: turns.toolCalls,
      durationMs: turns.durationMs,
      error: turns.error,
      createdAt: turns.createdAt,
      threadId: turns.threadId,
      agentName: agents.name,
      agentGlyph: agents.glyph,
    })
    .from(turns)
    .leftJoin(agents, eq(turns.agentId, agents.id))
    .orderBy(desc(turns.createdAt))
    .limit(25)
    .all()

  return { days, totals, byModel, byAgent, daily, recent }
}

export type UsageData = ReturnType<typeof getUsage>
