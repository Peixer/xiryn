// A minimal Telegram Bot API client: plain fetch, no SDK.
// https://core.telegram.org/bots/api

import { getSetting } from "@/lib/config"

function endpoint(token: string, method: string) {
  const base = (getSetting("telegram.apiUrl") ?? "https://api.telegram.org").replace(
    /\/+$/,
    ""
  )
  return `${base}/bot${token}/${method}`
}

export class TelegramError extends Error {
  constructor(
    message: string,
    public code: number,
    public retryAfter?: number
  ) {
    super(message)
    this.name = "TelegramError"
  }
}

export type TgUser = {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
}
export type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" }
export type TgMessage = {
  message_id: number
  from?: TgUser
  chat: TgChat
  date: number
  text?: string
  caption?: string
  photo?: unknown[]
  document?: unknown
}
export type TgCallbackQuery = {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}
export type TgUpdate = {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}
export type InlineKeyboard = { text: string; callback_data: string }[][]

export async function callTelegram<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const signals = [AbortSignal.timeout(options.timeoutMs ?? 30_000)]
  if (options.signal) signals.push(options.signal)

  const response = await fetch(endpoint(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
    signal: AbortSignal.any(signals),
    cache: "no-store",
  })
  const json = (await response.json().catch(() => null)) as {
    ok: boolean
    result?: T
    description?: string
    error_code?: number
    parameters?: { retry_after?: number }
  } | null

  if (!json?.ok) {
    throw new TelegramError(
      json?.description ?? `Telegram answered ${response.status}`,
      json?.error_code ?? response.status,
      json?.parameters?.retry_after
    )
  }
  return json.result as T
}

export async function sendPhoto(
  token: string,
  chatId: number,
  image: { base64: string; mediaType: string },
  caption?: string
) {
  const form = new FormData()
  form.set("chat_id", String(chatId))
  if (caption) form.set("caption", caption.slice(0, 1000))
  const extension = image.mediaType.split("/")[1] ?? "jpg"
  form.set(
    "photo",
    new Blob([Buffer.from(image.base64, "base64")], { type: image.mediaType }),
    `screen.${extension}`
  )
  const response = await fetch(endpoint(token, "sendPhoto"), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const json = (await response.json().catch(() => null)) as {
    ok: boolean
    description?: string
  } | null
  if (!json?.ok)
    throw new TelegramError(json?.description ?? "sendPhoto failed", response.status)
}
