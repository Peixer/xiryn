import { randomBytes } from "node:crypto"

import { and, desc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"

import { db } from "@/db"
import { agents, messages, squadMembers, squads, threads, type Agent } from "@/db/schema"
import {
  getActiveRun,
  startTurn,
  stopRun,
  subscribe,
  TurnError,
} from "@/lib/agent/runtime"
import type { OrynMessage } from "@/lib/agent/tools"
import { getSetting, setSetting } from "@/lib/config"
import { resolveModelSpec } from "@/lib/providers/registry"
import {
  callTelegram,
  sendPhoto,
  TelegramError,
  type InlineKeyboard,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from "@/lib/telegram/api"
import { markdownToTelegramHtml, plainText, splitMarkdown } from "@/lib/telegram/format"

/* ────────────────────────────────────────────────────────────────────
 * Remote access over Telegram.
 *
 * Oryn long-polls the Bot API from this machine, so it works behind any
 * router or firewall: no public URL, no webhook, no tunnel. Only one
 * Telegram account — the one that pairs with the code shown in Settings —
 * can talk to the bot. Everyone else is politely turned away.
 * ──────────────────────────────────────────────────────────────────── */

type BridgeState = {
  generation: number
  token: string | null
  controller: AbortController | null
  bot: { id: number; username: string; name: string } | null
  error: string | null
  lastPollAt: number | null
  queues: Map<number, Promise<void>>
  // A token Telegram refused; not retried until it changes
  rejected: string | null
  // Wrong pairing codes since the last rotation
  failedPairs: number
}

const globalForBridge = globalThis as unknown as { __orynTelegram?: BridgeState }
const state = (globalForBridge.__orynTelegram ??= {
  generation: 0,
  token: null,
  controller: null,
  bot: null,
  error: null,
  lastPollAt: null,
  queues: new Map(),
  rejected: null,
  failedPairs: 0,
})

const COMMANDS = [
  { command: "agents", description: "Pick the agent or squad to talk to" },
  { command: "new", description: "Start a fresh thread" },
  { command: "stop", description: "Stop the turn in progress" },
  { command: "status", description: "What Oryn is running" },
  { command: "help", description: "How this works" },
]

/* ───────────────────────────── state ──────────────────────────── */

export function getPairCode() {
  let code = getSetting("telegram.pairCode")
  if (!code) code = regeneratePairCode()
  return code
}

export function regeneratePairCode() {
  // Unambiguous characters only, so it can be typed from a phone
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const code = [...randomBytes(8)]
    .map((byte) => alphabet[byte % alphabet.length])
    .join("")
  setSetting("telegram.pairCode", code)
  return code
}

function ownerId() {
  const value = getSetting("telegram.ownerId")
  return value ? Number(value) : null
}

export function unpairTelegram() {
  setSetting("telegram.ownerId", null)
  setSetting("telegram.ownerName", null)
  setSetting("telegram.target", null)
  regeneratePairCode()
}

type Target = { agentId?: string; squadId?: string; threadId?: string }

function getTarget(): Target {
  try {
    return JSON.parse(getSetting("telegram.target") ?? "{}") as Target
  } catch {
    return {}
  }
}

function setTarget(target: Target) {
  setSetting("telegram.target", JSON.stringify(target))
}

export function telegramStatus() {
  const token = getSetting("telegram.botToken")
  const owner = ownerId()
  return {
    configured: !!token,
    running: !!state.controller && state.token === token,
    bot: state.bot,
    error: state.error,
    lastPollAt: state.lastPollAt,
    owner: owner
      ? { id: owner, name: getSetting("telegram.ownerName") ?? String(owner) }
      : null,
    pairCode: owner ? null : token ? getPairCode() : null,
  }
}

export type TelegramStatus = ReturnType<typeof telegramStatus>

/* ─────────────────────────── lifecycle ────────────────────────── */

// Starts, restarts or stops polling so it matches the configured token.
// Safe to call any number of times.
export function syncTelegram() {
  const token = getSetting("telegram.botToken") ?? null
  if (token === state.token && (state.controller || !token || state.rejected === token))
    return

  state.generation++
  state.controller?.abort()
  state.controller = null
  state.token = token
  state.bot = null
  state.error = null
  state.rejected = null

  if (!token) return
  const controller = new AbortController()
  state.controller = controller
  void poll(state.generation, token, controller.signal)
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    })
  })

async function poll(generation: number, token: string, signal: AbortSignal) {
  const live = () => state.generation === generation && !signal.aborted

  // Introduce ourselves; a bad token stops here
  while (live()) {
    try {
      const me = await callTelegram<TgUser>(token, "getMe", undefined, { signal })
      state.bot = { id: me.id, username: me.username ?? "", name: me.first_name }
      // Polling and webhooks are exclusive; make sure no webhook is left over
      await callTelegram(
        token,
        "deleteWebhook",
        { drop_pending_updates: false },
        { signal }
      )
      await callTelegram(
        token,
        "setMyCommands",
        { commands: COMMANDS },
        { signal }
      ).catch(() => {})
      state.error = null
      console.log(`[oryn] telegram: polling as @${state.bot.username}`)
      break
    } catch (error) {
      if (!live()) return
      if (error instanceof TelegramError && (error.code === 401 || error.code === 404)) {
        state.error = "Telegram rejected the bot token. Copy it again from @BotFather."
        state.rejected = token
        state.controller = null
        return
      }
      state.error = `Can't reach Telegram: ${error instanceof Error ? error.message : error}`
      await sleep(10_000, signal)
    }
  }

  let offset = 0
  while (live()) {
    try {
      const updates = await callTelegram<TgUpdate[]>(
        token,
        "getUpdates",
        { offset, timeout: 50, allowed_updates: ["message", "callback_query"] },
        { signal, timeoutMs: 65_000 }
      )
      state.lastPollAt = Date.now()
      state.error = null
      for (const update of updates) {
        offset = update.update_id + 1
        enqueue(token, update)
      }
    } catch (error) {
      if (!live()) return
      if (error instanceof TelegramError && error.code === 409) {
        state.error =
          "Another program is using this bot token (another Oryn, or a webhook). Only one can poll at a time."
        await sleep(15_000, signal)
      } else if (error instanceof TelegramError && error.code === 401) {
        state.error = "Telegram rejected the bot token. Copy it again from @BotFather."
        state.rejected = token
        state.controller = null
        return
      } else {
        state.error = `Lost contact with Telegram: ${error instanceof Error ? error.message : error}`
        await sleep(
          error instanceof TelegramError && error.retryAfter
            ? error.retryAfter * 1000
            : 5_000,
          signal
        )
      }
    }
  }
}

// Updates from one chat are handled in order; different chats in parallel
function enqueue(token: string, update: TgUpdate) {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? 0
  const previous = state.queues.get(chatId) ?? Promise.resolve()
  const next: Promise<void> = previous
    .then(async () => {
      await handle(token, update)
    })
    .catch((error: unknown) => console.error("[oryn] telegram: update failed:", error))
  state.queues.set(chatId, next)
  void next.finally(() => {
    if (state.queues.get(chatId) === next) state.queues.delete(chatId)
  })
}

/* ──────────────────────────── replies ─────────────────────────── */

async function say(
  token: string,
  chatId: number,
  markdown: string,
  extra: Record<string, unknown> = {}
) {
  let last: TgMessage | null = null
  for (const chunk of splitMarkdown(markdown)) {
    try {
      last = await callTelegram<TgMessage>(token, "sendMessage", {
        chat_id: chatId,
        text: markdownToTelegramHtml(chunk),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...extra,
      })
    } catch (error) {
      // Formatting Telegram can't parse: send it plain rather than not at all
      if (error instanceof TelegramError && error.code === 400) {
        last = await callTelegram<TgMessage>(token, "sendMessage", {
          chat_id: chatId,
          text: plainText(chunk).slice(0, 4096),
          ...extra,
        })
      } else {
        throw error
      }
    }
  }
  return last
}

async function edit(token: string, chatId: number, messageId: number, html: string) {
  await callTelegram(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  }).catch(() => {})
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/* ─────────────────────────── handling ─────────────────────────── */

async function handle(token: string, update: TgUpdate) {
  if (update.callback_query) return handleCallback(token, update.callback_query)
  const message = update.message
  if (!message?.from || message.chat.type !== "private") return

  const from = message.from
  const text = (message.text ?? "").trim()
  const owner = ownerId()

  if (owner !== from.id) {
    // Pairing: /start CODE (from the deep link) or /pair CODE
    const match = text.match(/^\/(?:start|pair)(?:@\w+)?\s+([A-Za-z0-9_-]+)/)
    const code = getSetting("telegram.pairCode")
    if (!owner && match && code && match[1].toUpperCase() === code) {
      const name = from.username
        ? `@${from.username}`
        : [from.first_name, from.last_name].filter(Boolean).join(" ")
      setSetting("telegram.ownerId", String(from.id))
      setSetting("telegram.ownerName", name)
      setSetting("telegram.pairCode", null)
      await say(
        token,
        message.chat.id,
        `**Paired.** This Telegram account now controls your Oryn.\n\nJust write a message to talk to your agent. Use /agents to switch agents or squads, /new for a fresh thread, /stop to interrupt.`
      )
      state.failedPairs = 0
      await sendAgentPicker(token, message.chat.id)
      return
    }
    // Guessing is pointless: a few wrong codes and the code changes
    if (!owner && match && ++state.failedPairs >= 5) {
      regeneratePairCode()
      state.failedPairs = 0
    }
    await say(
      token,
      message.chat.id,
      owner
        ? "🔒 This is a private Oryn instance."
        : "🔒 This Oryn isn't paired yet. Open **Settings → Remote access** on the computer running Oryn and use the pairing link or code shown there."
    )
    return
  }

  if (!text) {
    await say(token, message.chat.id, "I can only read text messages for now.")
    return
  }

  const command = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/)
  if (command) {
    const [, name, rest] = command
    switch (name.toLowerCase()) {
      case "start":
      case "help":
        return say(token, message.chat.id, helpText())
      case "agents":
      case "use":
        return sendAgentPicker(token, message.chat.id)
      case "new":
        return newThread(token, message.chat.id)
      case "stop": {
        const target = getTarget()
        const stopped = target.threadId ? stopRun(target.threadId) : false
        return say(token, message.chat.id, stopped ? "⏹ Stopped." : "Nothing is running.")
      }
      case "status":
        return say(token, message.chat.id, statusText())
      default:
        if (rest !== undefined) break
    }
  }

  await converse(token, message.chat.id, text)
}

function helpText() {
  return [
    "**Oryn — remote**",
    "Write a message and your current agent answers, working on its own workstation while your computer keeps running Oryn.",
    "",
    "/agents — pick an agent or squad",
    "/new — start a fresh thread",
    "/stop — interrupt the agent",
    "/status — what's running",
    "",
    "In a squad, start with `@Name` to address a specific member.",
    "Threads you start here also appear in the Oryn app on your computer.",
  ].join("\n")
}

function statusText() {
  const target = getTarget()
  const agent = target.agentId
    ? db.select().from(agents).where(eq(agents.id, target.agentId)).get()
    : null
  const squad = target.squadId
    ? db.select().from(squads).where(eq(squads.id, target.squadId)).get()
    : null
  const busy = target.threadId ? !!getActiveRun(target.threadId) : false
  return [
    "**Status**",
    `talking to: ${agent ? `${agent.name} (${agent.role})` : squad ? `squad ${squad.name}` : "nobody yet — /agents"}`,
    `model: \`${resolveModelSpec(agent?.model) ?? "not configured"}\``,
    `turn: ${busy ? "running" : "idle"}`,
  ].join("\n")
}

async function sendAgentPicker(token: string, chatId: number) {
  const agentRows = db.select().from(agents).orderBy(agents.createdAt).all()
  const squadRows = db.select().from(squads).orderBy(squads.createdAt).all()
  if (agentRows.length === 0) {
    await say(
      token,
      chatId,
      "You have no agents yet. Create one in the Oryn app on your computer, then come back."
    )
    return
  }
  const target = getTarget()
  const keyboard: InlineKeyboard = [
    ...agentRows.map((agent) => [
      {
        text: `${target.agentId === agent.id ? "● " : ""}${agent.name} — ${agent.role}`.slice(
          0,
          60
        ),
        callback_data: `use:a:${agent.id}`,
      },
    ]),
    ...squadRows.map((squad) => [
      {
        text: `${target.squadId === squad.id ? "● " : ""}⧉ ${squad.name}`.slice(0, 60),
        callback_data: `use:s:${squad.id}`,
      },
    ]),
  ]
  await callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: "Who do you want to talk to?",
    reply_markup: { inline_keyboard: keyboard },
  })
}

async function handleCallback(token: string, query: TgCallbackQuery) {
  if (query.from.id !== ownerId()) {
    await callTelegram(token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Private",
    }).catch(() => {})
    return
  }
  const match = query.data?.match(/^use:(a|s):(.+)$/)
  if (!match) return
  const [, kind, id] = match
  const chatId = query.message?.chat.id

  let label: string | null = null
  if (kind === "a") {
    const agent = db.select().from(agents).where(eq(agents.id, id)).get()
    if (agent) {
      setTarget({ agentId: agent.id, threadId: latestThread({ agentId: agent.id }) })
      label = `${agent.name} — ${agent.role}`
    }
  } else {
    const squad = db.select().from(squads).where(eq(squads.id, id)).get()
    if (squad) {
      setTarget({ squadId: squad.id, threadId: latestThread({ squadId: squad.id }) })
      label = `squad ${squad.name}`
    }
  }

  await callTelegram(token, "answerCallbackQuery", {
    callback_query_id: query.id,
    text: label ? `Talking to ${label}` : "That one no longer exists",
  }).catch(() => {})
  if (label && chatId && query.message) {
    await edit(
      token,
      chatId,
      query.message.message_id,
      `Now talking to <b>${escape(label)}</b>. Continuing its latest thread — /new starts a fresh one.`
    )
  }
}

function latestThread(owner: { agentId?: string; squadId?: string }) {
  const row = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      owner.agentId
        ? eq(threads.agentId, owner.agentId)
        : eq(threads.squadId, owner.squadId!)
    )
    .orderBy(desc(threads.activeAt))
    .get()
  return row?.id
}

async function newThread(token: string, chatId: number) {
  const target = resolveTarget()
  if (!target) return sendAgentPicker(token, chatId)
  const [thread] = db
    .insert(threads)
    .values({ agentId: target.agentId ?? null, squadId: target.squadId ?? null })
    .returning({ id: threads.id })
    .all()
  setTarget({ ...target, threadId: thread.id })
  await say(token, chatId, "🆕 Fresh thread. What's next?")
}

// The current target, falling back to the only agent when there is one
function resolveTarget(): Target | null {
  const target = getTarget()
  if (
    target.agentId &&
    db.select({ id: agents.id }).from(agents).where(eq(agents.id, target.agentId)).get()
  ) {
    return target
  }
  if (
    target.squadId &&
    db.select({ id: squads.id }).from(squads).where(eq(squads.id, target.squadId)).get()
  ) {
    return target
  }
  const all = db.select({ id: agents.id }).from(agents).limit(2).all()
  if (all.length === 1) {
    const fallback = {
      agentId: all[0].id,
      threadId: latestThread({ agentId: all[0].id }),
    }
    setTarget(fallback)
    return fallback
  }
  return null
}

/* ──────────────────────────── turns ───────────────────────────── */

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  shell: (i) => `$ ${String(i.command ?? "")}`,
  fs_read: (i) => `read ${String(i.path ?? "")}`,
  fs_write: (i) => `write ${String(i.path ?? "")}`,
  fs_list: (i) => `ls ${String(i.path ?? ".")}`,
  screen_capture: () => "looking at the screen",
  screen_share: () => "sharing the screen",
  pointer_click: (i) => `click ${i.x},${i.y}`,
  pointer_move: (i) => `move ${i.x},${i.y}`,
  pointer_drag: () => "drag",
  pointer_scroll: (i) => `scroll ${String(i.direction ?? "")}`,
  key_type: () => "typing",
  key_press: (i) => `key ${String(i.key ?? "")}`,
  web_search: (i) => `search “${String(i.query ?? "")}”`,
  web_fetch: (i) => `read ${String(i.url ?? "").replace(/^https?:\/\//, "")}`,
  memory_write: () => "saving to memory",
  memory_forget: () => "forgetting a note",
  delegate: () => "delegating",
}

async function converse(token: string, chatId: number, text: string) {
  const target = resolveTarget()
  if (!target) {
    await sendAgentPicker(token, chatId)
    return
  }

  // Squad members are addressed with a leading @Name
  let agentId: string | undefined
  let body = text
  if (target.squadId) {
    const members = db
      .select({ agent: agents })
      .from(squadMembers)
      .innerJoin(agents, eq(squadMembers.agentId, agents.id))
      .where(eq(squadMembers.squadId, target.squadId))
      .all()
      .map((row) => row.agent as Agent)
    const mention = text.match(/^@(\S+)\s+([\s\S]+)$/)
    const named =
      mention && members.find((m) => m.name.toLowerCase() === mention[1].toLowerCase())
    if (named && mention) {
      agentId = named.id
      body = mention[2]
    }
  }

  // Keep using the current thread unless it was deleted
  let threadId = target.threadId
  if (
    !threadId ||
    !db.select({ id: threads.id }).from(threads).where(eq(threads.id, threadId)).get()
  ) {
    const [thread] = db
      .insert(threads)
      .values({ agentId: target.agentId ?? null, squadId: target.squadId ?? null })
      .returning({ id: threads.id })
      .all()
    threadId = thread.id
    setTarget({ ...target, threadId })
  }

  const message = {
    id: nanoid(),
    role: "user",
    parts: [{ type: "text", text: body }],
  } as OrynMessage

  let run
  try {
    run = await startTurn({ threadId, message, agentId, channel: "telegram" })
  } catch (error) {
    const reason =
      error instanceof TurnError ? error.message : "Oryn couldn't start the turn."
    await say(
      token,
      chatId,
      `⚠️ ${reason}${error instanceof TurnError && error.status === 409 ? " Send /stop to interrupt it." : ""}`
    )
    return
  }

  const typing = () =>
    callTelegram(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(
      () => {}
    )
  void typing()
  const typingTimer = setInterval(typing, 4_500)

  // A single status message lists what the agent is doing, edited as it goes
  const steps: string[] = []
  let statusMessage: TgMessage | null = null
  let lastEdit = 0
  let pendingEdit: ReturnType<typeof setTimeout> | null = null
  let responseId: string | null = null
  let streamError: string | null = null
  const started = Date.now()

  const renderSteps = (done = false) =>
    `<code>${done ? "✓" : "⋯"} ${steps.length} step${steps.length === 1 ? "" : "s"}${done ? ` · ${((Date.now() - started) / 1000).toFixed(1)}s` : ""}</code>\n` +
    steps
      .slice(-6)
      .map((step) => `<code>${escape(step.slice(0, 90))}</code>`)
      .join("\n")

  const flush = async () => {
    pendingEdit = null
    lastEdit = Date.now()
    if (!statusMessage) {
      statusMessage = await callTelegram<TgMessage>(token, "sendMessage", {
        chat_id: chatId,
        text: renderSteps(),
        parse_mode: "HTML",
        disable_notification: true,
      }).catch(() => null)
    } else {
      await edit(token, chatId, statusMessage.message_id, renderSteps())
    }
  }

  try {
    const reader = subscribe(run).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === "start" && value.messageId) responseId = value.messageId
      if (value.type === "error") streamError = value.errorText
      if (value.type === "tool-input-available") {
        const label =
          TOOL_LABELS[value.toolName]?.((value.input ?? {}) as Record<string, unknown>) ??
          value.toolName
        steps.push(label)
        // Telegram rate-limits edits; batch them
        if (!pendingEdit)
          pendingEdit = setTimeout(flush, Math.max(0, 1_500 - (Date.now() - lastEdit)))
      }
    }
  } finally {
    clearInterval(typingTimer)
    if (pendingEdit) clearTimeout(pendingEdit)
  }

  if (statusMessage)
    await edit(token, chatId, (statusMessage as TgMessage).message_id, renderSteps(true))

  // The finished reply, as saved to the thread
  const saved = responseId
    ? db
        .select()
        .from(messages)
        .where(and(eq(messages.id, responseId), eq(messages.threadId, threadId)))
        .get()
    : null
  const reply = saved
    ? ({ ...saved, metadata: saved.metadata ?? undefined } as unknown as OrynMessage)
    : null

  let sentSomething = false
  if (reply) {
    const memberNames = new Map(
      db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .all()
        .map((a) => [a.id, a.name])
    )
    let buffer = ""
    const flushText = async () => {
      if (buffer.trim()) {
        await say(token, chatId, buffer.trim())
        sentSomething = true
      }
      buffer = ""
    }
    for (const part of reply.parts) {
      if (part.type === "text") buffer += `${part.text}\n\n`
      if (part.type === "tool-delegate" && part.state === "output-available") {
        await flushText()
        await say(
          token,
          chatId,
          `↳ _handed to **${memberNames.get(part.output.agentId) ?? part.output.name}**_`
        )
      }
      if (
        part.type === "tool-screen_share" &&
        part.state === "output-available" &&
        part.output.image
      ) {
        await flushText()
        await sendPhoto(token, chatId, {
          base64: part.output.image,
          mediaType: part.output.mediaType,
        }).catch((error) => console.error("[oryn] telegram: sendPhoto failed:", error))
        sentSomething = true
      }
    }
    await flushText()
  }

  if (streamError) {
    await say(token, chatId, `⚠️ ${streamError}`)
  } else if (!sentSomething) {
    await say(
      token,
      chatId,
      "_(no reply — the turn was stopped or produced only tool calls)_"
    )
  }
}
