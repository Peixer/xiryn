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
  // Give the first getMe a moment so the panel can show the bot's name
  await new Promise((resolve) => setTimeout(resolve, 1500))
  revalidatePath("/", "layout")
  return getTelegramPanel()
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
