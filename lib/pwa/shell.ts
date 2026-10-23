// The app shell replaces the desktop workbench on a phone-sized viewport
// and whenever the site is installed (standalone, fullscreen, minimal-ui).

export const PHONE_MAX_WIDTH = 767

// Side-by-side chat and workbench only at this width and above. Below it the
// workbench panel still owned a share of the row after its contents were
// hidden, so the conversation was stuck at about 60% of a phone or tablet.
// Keep this in step with the max-width query in app/globals.css.
export const WORKBENCH_SPLIT_MIN_WIDTH = 1100

export function workbenchPlacement(input: { width: number; appShell: boolean }) {
  if (input.appShell) return "overlay" as const
  if (input.width < WORKBENCH_SPLIT_MIN_WIDTH) return "overlay" as const
  return "split" as const
}

export function wantsAppShell(input: {
  displayMode?: string | null
  navigatorStandalone?: boolean
  width?: number | null
}) {
  if (input.navigatorStandalone) return true
  const mode = input.displayMode ?? ""
  if (mode === "standalone" || mode === "fullscreen" || mode === "minimal-ui") return true
  if (typeof input.width === "number" && input.width <= PHONE_MAX_WIDTH) return true
  return false
}

export function isThreadPath(pathname: string) {
  return /^\/(?:a|s)\/[^/]+\/[^/]+$/.test(pathname)
}

export function shouldOfferInstallGuide(input: {
  ios: boolean
  safari: boolean
  standalone: boolean
  dismissed: boolean
}) {
  return input.ios && input.safari && !input.standalone && !input.dismissed
}

const IOS_DEVICE = /iPad|iPhone|iPod/
const OTHER_IOS_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/

export function isIosSafariUserAgent(ua: string) {
  return IOS_DEVICE.test(ua) && /Safari/i.test(ua) && !OTHER_IOS_BROWSER.test(ua)
}
