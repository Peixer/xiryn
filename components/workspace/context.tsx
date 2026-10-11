"use client"

import * as React from "react"

import type { Navigation, NavAgent, NavSquad, SystemStatus } from "@/queries/workspace"

export type AgentTemplate = {
  name: string
  role: string
  instructions: string
}

type DialogState =
  | { kind: "agent"; agent?: NavAgent; template?: AgentTemplate }
  | { kind: "squad"; squad?: NavSquad }
  | { kind: "palette" }
  | null

type WorkspaceContextValue = {
  nav: Navigation
  status: SystemStatus
  dialog: DialogState
  openAgentDialog: (options?: { agent?: NavAgent; template?: AgentTemplate }) => void
  openSquadDialog: (options?: { squad?: NavSquad }) => void
  openPalette: () => void
  closeDialog: () => void
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const value = React.useContext(WorkspaceContext)
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>")
  return value
}

export function WorkspaceProvider({
  nav,
  status,
  children,
}: {
  nav: Navigation
  status: SystemStatus
  children: React.ReactNode
}) {
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      nav,
      status,
      dialog,
      openAgentDialog: (options) => setDialog({ kind: "agent", ...options }),
      openSquadDialog: (options) => setDialog({ kind: "squad", ...options }),
      openPalette: () => setDialog({ kind: "palette" }),
      closeDialog: () => setDialog(null),
      mobileNavOpen,
      setMobileNavOpen,
    }),
    [nav, status, dialog, mobileNavOpen]
  )

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>
}

// Starting points offered when creating an agent
export const agentTemplates: AgentTemplate[] = [
  {
    name: "Vega",
    role: "Research analyst",
    instructions:
      "Search widely, read primary sources, and cross-check claims before stating them. Lead with the answer, then the evidence, with a link for every non-obvious fact. Flag uncertainty explicitly.",
  },
  {
    name: "Rigel",
    role: "Software engineer",
    instructions:
      "Work in your workstation: clone, build, run and test before you report. Prefer small, verifiable steps. Show the commands you ran and their results; never claim something works without running it.",
  },
  {
    name: "Lyra",
    role: "Data analyst",
    instructions:
      "Use Python on your workstation (pandas, matplotlib) to load, clean and analyse data. State assumptions, show the numbers that matter, and save charts and outputs as files.",
  },
  {
    name: "Atlas",
    role: "Operator — browser and desktop tasks",
    instructions:
      "Use the desktop for tasks that need a real browser. Look at the screen before and after every action. Ask before submitting forms, purchasing, or sending anything on the person's behalf.",
  },
]
