import { cn } from "@/lib/utils"

// The Xiryn mark: an open orbit with Orion's belt rising through the gap
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-6 shrink-0", className)}>
      <rect width="64" height="64" rx="15" fill="#0B0E14" />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="14.5"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.09"
      />
      <path
        d="M37.56 13.83 A19 19 0 1 0 50.17 26.45"
        fill="none"
        stroke="#EAF2FF"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <circle cx="45.4" cy="18.6" r="7.5" fill="#7CC4FF" fillOpacity="0.16" />
      <circle cx="32" cy="32" r="2.5" fill="#BFE2FF" />
      <circle cx="38.7" cy="25.3" r="3" fill="#E8F4FF" />
      <circle cx="45.4" cy="18.6" r="3.6" fill="#FFFFFF" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-[15px] font-semibold tracking-[-0.02em] lowercase",
        className
      )}
    >
      xiryn
    </span>
  )
}
