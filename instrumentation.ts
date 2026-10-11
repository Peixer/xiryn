// Runs once when the Oryn server boots
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Open the database (and apply pending migrations) before the first request
  const { connect } = await import("./db")
  connect()

  // Resume the Telegram bridge if a bot token is configured
  const { syncTelegram } = await import("./lib/telegram/bridge")
  syncTelegram()

  // Workstations: see whether Docker is there, tidy up after deleted agents,
  // and get the workstation image ready so the first task doesn't wait for it
  const { probeEngine } = await import("./lib/docker")
  const { startWorkstationJanitor } = await import("./lib/workstation")
  const { buildImage, getImageState } = await import("./lib/workstation-image")
  const engine = await probeEngine().catch(() => null)
  startWorkstationJanitor()
  if (engine?.state === "ready") {
    getImageState()
      .then((image) => {
        if (image.state === "absent") {
          console.log("[oryn] building the agent workstation image (first run only)…")
          return buildImage().then((tag) =>
            console.log(`[oryn] workstation image ready: ${tag}`)
          )
        }
      })
      .catch((error) => console.error("[oryn] workstation image:", error))
  }
}
