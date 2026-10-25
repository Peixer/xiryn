// Runs once when the Xiryn server boots
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Open the database (and apply pending migrations) before the first request
  const { connect } = await import("./db")
  connect()

  // Same-origin VNC for a public XIRYN_URL. Each colour keeps its own port,
  // including the one that is not serving, so a standby desktop still connects.
  const { startDesktopProxy } = await import("./lib/desktop-proxy")
  startDesktopProxy()

  // Telegram, routines, and the workstation janitor run only on the active
  // colour. The idle process stays up for health checks and a later switch.
  const { followDuty } = await import("./lib/self-update/duty")
  const { setTelegramPolling } = await import("./lib/telegram/bridge")
  const { startRoutines, stopRoutines } = await import("./lib/routines")
  const { startWorkstationJanitor, stopWorkstationJanitor } =
    await import("./lib/workstation")
  const { startVaultSweep, stopVaultSweep } = await import("./lib/vault")
  const { startNotifyWebhook, stopNotifyWebhook } = await import("./lib/notify-webhook")
  const { startWebPush, stopWebPush } = await import("./lib/web-push")
  const { probeEngine } = await import("./lib/docker")
  const { buildImage, getImageState, observeWorkstationBuild } =
    await import("./lib/workstation-image")

  let imageAttempted = false
  const globalForDuty = globalThis as unknown as {
    __xirynDuty?: { close(): void }
  }
  globalForDuty.__xirynDuty?.close()
  globalForDuty.__xirynDuty = followDuty({
    start() {
      setTelegramPolling(true)
      startRoutines()
      void import("./lib/work-sessions")
        .then(({ recoverWorkSessions }) => recoverWorkSessions())
        .catch((error) => console.error("[xiryn] work sessions:", error))
      startWorkstationJanitor()
      startVaultSweep()
      startNotifyWebhook()
      startWebPush()
      if (imageAttempted) return
      imageAttempted = true
      probeEngine()
        .then((engine) => {
          if (engine?.state !== "ready") return
          return getImageState().then((image) => {
            if (image.state !== "absent") return
            console.log("[xiryn] building the agent workstation image (first run only)…")
            observeWorkstationBuild(
              buildImage().then((tag) => {
                console.log(`[xiryn] workstation image ready: ${tag}`)
                return tag
              })
            )
          })
        })
        .catch((error) => console.error("[xiryn] workstation image:", error))
    },
    stop() {
      setTelegramPolling(false)
      stopRoutines()
      stopWorkstationJanitor()
      stopVaultSweep()
      stopNotifyWebhook()
      stopWebPush()
    },
    quiesce() {
      void import("./lib/self-update/write-freeze").then((gate) =>
        gate.quiesceThisProcess()
      )
    },
    resumeWrites() {
      void import("./lib/self-update/write-freeze").then((gate) =>
        gate.resumeThisProcess()
      )
    },
  })
}
