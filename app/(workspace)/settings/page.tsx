import type { Metadata } from "next"

import { getTelegramPanel } from "@/actions/telegram"
import { SettingsForm } from "@/components/settings/settings-form"
import { TelegramPanelView } from "@/components/settings/telegram-panel"
import { getSettingsView } from "@/queries/workspace"

export const metadata: Metadata = { title: "Settings" }

export default async function Page() {
  const data = getSettingsView()
  const telegram = await getTelegramPanel()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsForm data={data} telegram={<TelegramPanelView initial={telegram} />} />
    </div>
  )
}
