import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isIosSafariUserAgent,
  isThreadPath,
  PHONE_MAX_WIDTH,
  shouldOfferInstallGuide,
  wantsAppShell,
} from "./shell"

test("the app shell is for an installed window or a phone-sized viewport", () => {
  assert.equal(PHONE_MAX_WIDTH, 767)
  assert.equal(wantsAppShell({ displayMode: "browser", width: 1280 }), false)
  assert.equal(wantsAppShell({ displayMode: "browser", width: 390 }), true)
  assert.equal(wantsAppShell({ displayMode: "browser", width: 767 }), true)
  assert.equal(wantsAppShell({ displayMode: "browser", width: 768 }), false)
  assert.equal(wantsAppShell({ displayMode: "standalone", width: 1440 }), true)
  assert.equal(wantsAppShell({ displayMode: "fullscreen", width: 1440 }), true)
  assert.equal(wantsAppShell({ displayMode: "minimal-ui", width: 1440 }), true)
  assert.equal(wantsAppShell({ navigatorStandalone: true, width: 1440 }), true)
  assert.equal(isThreadPath("/a/agent/thread"), true)
  assert.equal(isThreadPath("/s/squad/thread"), true)
  assert.equal(isThreadPath("/a/agent"), false)
  assert.equal(isThreadPath("/"), false)
  assert.equal(isThreadPath("/agents"), false)
})

test("the home-screen guide is only for iOS Safari that is not installed yet", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  const chromeIos =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1"
  assert.equal(isIosSafariUserAgent(iphone), true)
  assert.equal(isIosSafariUserAgent(chromeIos), false)
  assert.equal(isIosSafariUserAgent("Mozilla/5.0 Macintosh Safari/605"), false)
  assert.equal(
    shouldOfferInstallGuide({
      ios: true,
      safari: true,
      standalone: false,
      dismissed: false,
    }),
    true
  )
  assert.equal(
    shouldOfferInstallGuide({
      ios: true,
      safari: true,
      standalone: true,
      dismissed: false,
    }),
    false
  )
  assert.equal(
    shouldOfferInstallGuide({
      ios: true,
      safari: true,
      standalone: false,
      dismissed: true,
    }),
    false
  )
  assert.equal(
    shouldOfferInstallGuide({
      ios: false,
      safari: true,
      standalone: false,
      dismissed: false,
    }),
    false
  )
  assert.equal(
    shouldOfferInstallGuide({
      ios: true,
      safari: false,
      standalone: false,
      dismissed: false,
    }),
    false
  )
})
