// The app shell replaces the desktop workbench on a phone-sized viewport
// and whenever the site is installed (standalone, fullscreen, minimal-ui).

export const PHONE_MAX_WIDTH = 767

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
