import type { ToolSet } from "ai"

import { createWorkSessionTools, type ToolEnv } from "@/lib/agent/tools"

// Scheduled routines and coding-session wakes run with nobody watching.
// spawn_work_session stays off those turns. The person starts a coding
// session from a conversation they are in (the app or Telegram).
export function canSpawnWorkSession(input: {
  workstation: boolean
  routine: boolean
  wake: boolean
}) {
  return input.workstation && !input.routine && !input.wake
}

export function workSessionToolsForTurn(
  env: ToolEnv,
  input: { workstation: boolean; routine: boolean; wake: boolean }
): ToolSet {
  if (!input.workstation) return {}
  const tools = createWorkSessionTools(env)
  if (canSpawnWorkSession(input)) return tools
  return {
    list_work_sessions: tools.list_work_sessions,
    get_work_session: tools.get_work_session,
    cancel_work_session: tools.cancel_work_session,
  }
}
