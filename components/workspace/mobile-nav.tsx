"use client"

import Link from "next/link"
import { MenuIcon } from "lucide-react"

import { LogoMark, Wordmark } from "@/components/brand"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useWorkspace } from "@/components/workspace/context"
import { Sidebar } from "@/components/workspace/sidebar"

// Below md the sidebar becomes a drawer behind a top bar
export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen } = useWorkspace()

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
          className="-ml-1 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <MenuIcon className="size-4" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="size-5" />
          <Wordmark className="text-[14px]" />
        </Link>
      </div>
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 h-svh max-w-[280px] translate-x-0 translate-y-0 gap-0 rounded-none p-0 ring-0 data-open:slide-in-from-left sm:max-w-[280px]"
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <Sidebar onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
