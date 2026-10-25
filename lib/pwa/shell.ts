// The app shell replaces the desktop workbench on a phone-sized viewport.
// A wider window keeps the desktop layout, including an installed app.

export const PHONE_MAX_WIDTH = 767

// The side-by-side workbench is the desktop layout, including a laptop window
// and an installed app on a desktop. Only a phone-sized viewport collapses the
// outer panel. An installed window does not, unless it is also that narrow.
// Keep this in step with the phone query in app/globals.css.
export function workbenchPlacement(input: { width: number; appShell: boolean }) {
  void input.appShell
  if (input.width <= PHONE_MAX_WIDTH) return "overlay" as const
  return "split" as const
}

export function wantsAppShell(input: {
  displayMode?: string | null
  navigatorStandalone?: boolean
  width?: number | null
}) {
  void input.displayMode
  void input.navigatorStandalone
  if (typeof input.width === "number" && input.width <= PHONE_MAX_WIDTH) return true
  return false
}

// The phone shell is position fixed over the page. Mark the page inert only
// while that shell is actually showing, so a wide window can still scroll.
export function shellCoversPage(input: {
  phone: boolean
  list: boolean
  offline: boolean
}) {
  return input.phone && (input.list || input.offline)
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
