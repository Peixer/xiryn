"use client"

import Link from "next/link"

import { useWorkspace } from "@/components/workspace/context"
import { cn } from "@/lib/utils"

function Dot({ on, warn }: { on: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full",
        on ? "bg-ok" : warn ? "bg-betelgeuse" : "bg-faint/60"
      )}
    />
  )
}

function Cell({
  children,
  href,
  title,
  className,
}: {
  children: React.ReactNode
  href?: string
  title?: string
  className?: string
}) {
  const classes = cn(
    "flex h-full items-center gap-1.5 px-2.5 whitespace-nowrap transition-colors",
    href && "hover:bg-accent/60 hover:text-foreground",
    className
  )
  return href ? (
    <Link href={href} title={title} className={classes}>
      {children}
    </Link>
  ) : (
    <span title={title} className={classes}>
      {children}
    </span>
  )
}

export function StatusBar() {
  const { status } = useWorkspace()
  const host = status.host ?? "localhost"

  return (
    <footer className="flex h-7 shrink-0 items-stretch overflow-x-auto border-t bg-surface/60 font-mono text-[10.5px] text-muted-foreground">
      <Cell title="Everything runs on this machine">
        <Dot on />
        local · {host}
      </Cell>
      <Cell href="/settings#model" title="Default model">
        <Dot on={!!status.defaultModel} warn />
        {status.defaultModel ?? "no model configured"}
      </Cell>
      <Cell
        href="/settings#integrations"
        title="Docker workstations"
        className="max-sm:hidden"
      >
        <Dot on={status.workstation} />
        workstations{" "}
        {status.docker === "ready" ? "on" : status.workstation ? "idle" : "off"}
      </Cell>
      <Cell
        href="/settings#integrations"
        title="Firecrawl web access"
        className="max-sm:hidden"
      >
        <Dot on={status.web} />
        web {status.web ? "on" : "off"}
      </Cell>
      <span className="flex-1" />
      {status.running.length > 0 && (
        <Cell className="text-rigel">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-rigel text-rigel" />
          {status.running.length} running
        </Cell>
      )}
      <Cell title={status.dbPath} className="max-md:hidden">
        sqlite
      </Cell>
      <Cell className="max-md:hidden">node {status.node.replace(/^v/, "")}</Cell>
      <Cell>oryn {status.version}</Cell>
    </footer>
  )
}
