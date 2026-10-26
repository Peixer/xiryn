export type AgentCategory = "general" | "coding" | "research" | "assistant"

export const CATEGORY_LABELS: Record<AgentCategory, string> = {
  general: "General",
  coding: "Coding",
  research: "Research",
  assistant: "Assistant",
}

export const CATEGORY_DESCRIPTIONS: Record<AgentCategory, string> = {
  general: "Standard agent for everyday tasks.",
  coding: "Coding specialist. Gets Codex CLI and its own git credential.",
  research: "Optimized for deep web research and analysis.",
  assistant: "Optimized for everyday assistance and task management.",
}
