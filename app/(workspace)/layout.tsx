import { headers } from "next/headers"

import { AgentDialog } from "@/components/dialogs/agent-dialog"
import { SquadDialog } from "@/components/dialogs/squad-dialog"
import { CommandPalette } from "@/components/workspace/command-palette"
import { WorkspaceProvider } from "@/components/workspace/context"
import { MobileNav } from "@/components/workspace/mobile-nav"
import { NotificationsProvider } from "@/components/workspace/notifier"
import { Sidebar } from "@/components/workspace/sidebar"
import { StatusBar } from "@/components/workspace/status-bar"
import { getNavigation, getSystemStatus } from "@/queries/workspace"

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const nav = getNavigation()
  const status = { ...getSystemStatus(), host: (await headers()).get("host") }

  return (
    <WorkspaceProvider nav={nav} status={status}>
      <NotificationsProvider>
        <div className="flex h-svh flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="hidden w-[256px] shrink-0 border-r md:flex">
              <Sidebar />
            </div>
            <main className="flex min-w-0 flex-1 flex-col">
              <MobileNav />
              {children}
            </main>
          </div>
          <StatusBar />
        </div>
        <CommandPalette />
        <AgentDialog />
        <SquadDialog />
      </NotificationsProvider>
    </WorkspaceProvider>
  )
}
