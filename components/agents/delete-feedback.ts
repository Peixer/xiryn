import { toast } from "@/components/ui/toast"
import type { deleteAgent } from "@/actions/agents"

type Outcome = Awaited<ReturnType<typeof deleteAgent>>

// Tells the person how a deletion went. Returns true when the agent is gone.
export function reportDeletion(outcome: Outcome) {
  if (!outcome.ok) {
    toast.add({
      type: "error",
      title: "Couldn't delete the agent",
      description: outcome.error,
    })
    return false
  }
  toast.add({
    type: "success",
    title: `${outcome.name} deleted`,
    description:
      outcome.workstation === "pending"
        ? "Its workstation will be removed in the background as soon as Docker can do it."
        : "Its threads, memory, routines and workstation are gone.",
  })
  return true
}
