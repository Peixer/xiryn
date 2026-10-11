// Runs once when the Oryn server boots
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Open the database (and apply pending migrations) before the first request
  await import("./db")

  // Resume the Telegram bridge if a bot token is configured
  const { syncTelegram } = await import("./lib/telegram/bridge")
  syncTelegram()
}
