"use server"

import { revalidatePath } from "next/cache"
import QRCode from "qrcode"

import { setSetting } from "@/lib/config"
import {
  regeneratePairCode,
  syncTelegram,
  telegramStatus,
  unpairTelegram,
} from "@/lib/telegram/bridge"

// Everything the Remote access panel shows, including a QR code that opens
// the bot with the pairing code already filled in
export async function getTelegramPanel() {
  syncTelegram()
  const status = telegramStatus()
  const link =
    status.bot?.username && status.pairCode
      ? `https://t.me/${status.bot.username}?start=${status.pairCode}`
      : null
  const qr = link
    ? await QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
    : null
  return { ...status, link, qr }
}

export type TelegramPanel = Awaited<ReturnType<typeof getTelegramPanel>>

export async function saveTelegramToken(token: string | null) {
  const value = token?.trim() || null
  if (value && !/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(value)) {
    throw new Error(
      "That doesn't look like a bot token. It should look like 123456789:AA…"
    )
  }
  setSetting("telegram.botToken", value)
  if (!value) unpairTelegram()
  syncTelegram()
  // Wait for Telegram's first answer (or refusal) so the panel can show the
  // bot's name. On a slow connection that can take several seconds.
  let panel = await getTelegramPanel()
  for (
    let waited = 0;
    value && !panel.bot && !panel.error && waited < 15_000;
    waited += 500
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    panel = await getTelegramPanel()
  }
  revalidatePath("/", "layout")
  return panel
}

export async function newPairingCode() {
  regeneratePairCode()
  return getTelegramPanel()
}

export async function unpair() {
  unpairTelegram()
  revalidatePath("/", "layout")
  return getTelegramPanel()
}
