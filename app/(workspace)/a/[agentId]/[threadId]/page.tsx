import type { Metadata } from "next"

import { ThreadPage } from "@/components/thread/thread-page"
import { getThread } from "@/queries/workspace"

type Params = { params: Promise<{ agentId: string; threadId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { threadId } = await params
  const thread = getThread(threadId)
  return {
    title: thread?.agent
      ? `${thread.agent.name} · ${thread.title ?? "New thread"}`
      : "Thread",
  }
}

export default async function Page({ params }: Params) {
  const { agentId, threadId } = await params
  return <ThreadPage threadId={threadId} owner={{ agentId }} />
}
