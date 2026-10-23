import type { Metadata } from "next"
import { headers } from "next/headers"

import { AppShell } from "@/components/app/app-shell"
import { OfflineProvider } from "@/components/app/offline-provider"
import { AgentDialog } from "@/components/dialogs/agent-dialog"
import { SquadDialog } from "@/components/dialogs/squad-dialog"
import { FeedbackPrompt } from "@/components/feedback/feedback-prompt"
import { CommandPalette } from "@/components/workspace/command-palette"
import { WorkspaceProvider } from "@/components/workspace/context"
import { MobileNav } from "@/components/workspace/mobile-nav"
import { NotificationsProvider } from "@/components/workspace/notifier"
import { Sidebar } from "@/components/workspace/sidebar"
import { StatusBar } from "@/components/workspace/status-bar"
import {
  getAgentOverview,
  getNavigation,
  getRoutines,
  getSystemStatus,
} from "@/queries/workspace"

// Next's file-based manifest link has no crossorigin attribute (it adds one
// only for Vercel preview). Browsers use the first manifest link, so this
// clears that tag. The root layout emits the credentialed link instead.
export const metadata: Metadata = { manifest: null }

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const nav = getNavigation()
  const agents = getAgentOverview()
  const routines = getRoutines()
  const status = { ...getSystemStatus(), host: (await headers()).get("host") }

  return (
    <WorkspaceProvider nav={nav} status={status}>
      <NotificationsProvider>
        <OfflineProvider>
          <div className="xiryn-frame flex h-svh flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="xiryn-only-desktop hidden w-[256px] shrink-0 border-r md:flex">
                <Sidebar />
              </div>
              <main className="flex min-w-0 flex-1 flex-col">
                <div className="xiryn-only-desktop">
                  <MobileNav />
                </div>
                <div className="xiryn-page flex min-h-0 flex-1 flex-col">{children}</div>
              </main>
            </div>
            <div className="xiryn-only-desktop">
              <StatusBar />
            </div>
          </div>
          <AppShell agents={agents} routines={routines} />
          <CommandPalette />
          <AgentDialog />
          <SquadDialog />
          <FeedbackPrompt />
        </OfflineProvider>
      </NotificationsProvider>
    </WorkspaceProvider>
  )
}
