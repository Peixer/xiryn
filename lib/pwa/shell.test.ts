import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  isIosSafariUserAgent,
  isThreadPath,
  PHONE_MAX_WIDTH,
  shouldOfferInstallGuide,
  wantsAppShell,
  workbenchPlacement,
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

test("the workbench collapses only on a phone-sized viewport", () => {
  assert.equal(workbenchPlacement({ width: 360, appShell: false }), "overlay")
  assert.equal(workbenchPlacement({ width: 390, appShell: true }), "overlay")
  assert.equal(workbenchPlacement({ width: 767, appShell: false }), "overlay")
  assert.equal(workbenchPlacement({ width: 768, appShell: false }), "split")
  assert.equal(workbenchPlacement({ width: 820, appShell: false }), "split")
  assert.equal(workbenchPlacement({ width: 1024, appShell: false }), "split")
  assert.equal(workbenchPlacement({ width: 1024, appShell: true }), "split")
  assert.equal(workbenchPlacement({ width: 1280, appShell: false }), "split")
  assert.equal(workbenchPlacement({ width: 1440, appShell: false }), "split")
  assert.equal(workbenchPlacement({ width: 1440, appShell: true }), "split")
  assert.equal(workbenchPlacement({ width: 1920, appShell: true }), "split")
})

test("phone CSS collapses the workbench panel, and wider windows do not", () => {
  const css = fs.readFileSync(
    path.join(import.meta.dirname, "../../app/globals.css"),
    "utf8"
  )
  const phone = css.match(/@media \(max-width: 767px\) \{[\s\S]*?\n\}/)
  assert.ok(phone, "phone media query")
  assert.match(phone[0], /\[data-panel\]:has\(> \.xiryn-workbench\)/)
  assert.match(phone[0], /\[data-panel\]:has\(> \.xiryn-chat-panel\)/)
  assert.doesNotMatch(css, /max-width:\s*1099px/)
  assert.doesNotMatch(css, /html\[data-xiryn-app="1"\] \[data-panel\]/)
})

test("the phone settings menu has an Update version entry", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "../../components/app/app-shell.tsx"),
    "utf8"
  )
  assert.match(source, /Update version/)
  assert.match(source, /updateAvailable/)
  assert.match(source, /SelfUpdatePanel/)
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
