import { spawn } from "node:child_process"

import { getSetting } from "@/lib/config"

// A notification from the operating system itself, for when no Xiryn tab is
// open to show one: a routine finished overnight, an agent needs you while
// Xiryn runs in the background. The text goes to the notifier as arguments
// or environment, never through a shell.

const WINDOWS_TOAST = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName('text')
$texts.Item(0).AppendChild($template.CreateTextNode($env:XIRYN_TITLE)) > $null
$texts.Item(1).AppendChild($template.CreateTextNode($env:XIRYN_BODY)) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
`

export function desktopNotificationsEnabled() {
  return getSetting("notify.desktop") !== "off"
}

export function notifyDesktop(title: string, body: string) {
  if (!desktopNotificationsEnabled()) return
  const short = body.length > 200 ? `${body.slice(0, 199)}…` : body
  try {
    const child =
      process.platform === "win32"
        ? spawn(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-WindowStyle",
              "Hidden",
              "-Command",
              WINDOWS_TOAST,
            ],
            {
              env: { ...process.env, XIRYN_TITLE: title, XIRYN_BODY: short },
              stdio: "ignore",
              windowsHide: true,
            }
          )
        : process.platform === "darwin"
          ? spawn(
              "osascript",
              [
                "-e",
                "on run argv",
                "-e",
                "display notification (item 2 of argv) with title (item 1 of argv)",
                "-e",
                "end run",
                title,
                short,
              ],
              { stdio: "ignore" }
            )
          : spawn("notify-send", ["--app-name=Xiryn", title, short], { stdio: "ignore" })
    // No notifier on this system (a server without a desktop): nothing to do
    child.on("error", () => {})
    child.unref()
  } catch {}
}
