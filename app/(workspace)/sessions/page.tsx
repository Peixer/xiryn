import { SessionsPanel } from "@/components/work-sessions/sessions-panel"
export default function SessionsPage() {
  return (
    <div className="flex-1 space-y-6 overflow-auto p-6 pb-24">
      <h1 className="text-2xl font-semibold">Sessions</h1>
      <SessionsPanel />
    </div>
  )
}
