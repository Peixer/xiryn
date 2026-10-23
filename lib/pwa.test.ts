import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { NextRequest } from "next/server"

import manifest from "../app/manifest"
import { config, proxy } from "../proxy"
import {
  pwaAppleTouchIcon,
  pwaDescription,
  pwaIcons,
  pwaManifestPath,
  pwaName,
  pwaShortName,
  pwaStartupImages,
  pwaThemeColorDark,
  pwaThemeColorLight,
  webAppManifest,
} from "./pwa"
import { serviceWorkerSource } from "./pwa/cache-policy"

function pngSize(file: string) {
  const buf = readFileSync(file)
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR")
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test("the manifest has the installable fields and no worker", () => {
  const fromRoute = manifest()
  const fromLib = webAppManifest()
  assert.deepEqual(fromRoute, fromLib)

  assert.equal(fromRoute.name, pwaName)
  assert.equal(fromRoute.name, "Xiryn")
  assert.equal(fromRoute.short_name, pwaShortName)
  assert.ok(fromRoute.short_name && fromRoute.short_name.length <= 12)
  assert.equal(fromRoute.description, pwaDescription)
  assert.equal(fromRoute.start_url, "/")
  assert.equal(fromRoute.scope, "/")
  assert.equal(fromRoute.id, "/")
  assert.equal(fromRoute.display, "standalone")
  assert.equal(fromRoute.theme_color, pwaThemeColorDark)
  assert.equal(fromRoute.background_color, pwaThemeColorDark)
  assert.equal(pwaThemeColorLight, "#fafbfc")
  assert.notEqual(fromRoute.prefer_related_applications, true)
  assert.equal("serviceworker" in fromRoute, false)

  assert.deepEqual(
    fromRoute.icons?.map((icon) => icon.src),
    pwaIcons.map((icon) => icon.src)
  )
  assert.ok(
    fromRoute.icons?.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")
  )
  assert.ok(
    fromRoute.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")
  )
  assert.ok(
    fromRoute.icons?.some(
      (icon) => icon.sizes === "512x512" && icon.purpose === "maskable"
    )
  )
})

test("declared icons exist and match their sizes", () => {
  const icons = [
    ...pwaIcons,
    {
      src: pwaAppleTouchIcon.src,
      sizes: pwaAppleTouchIcon.sizes,
      type: pwaAppleTouchIcon.type,
    },
  ]
  for (const icon of icons) {
    assert.equal(icon.type, "image/png")
    const file = path.join(process.cwd(), "public", icon.src.slice(1))
    const { width, height } = pngSize(file)
    const [declaredWidth, declaredHeight] = icon.sizes.split("x").map(Number)
    assert.equal(width, declaredWidth, icon.src)
    assert.equal(height, declaredHeight, icon.src)
    const bytes = readFileSync(file).byteLength
    assert.ok(bytes < 48 * 1024, `${icon.src} is ${bytes} bytes`)
  }
})

test("the document asks the browser to send basic-auth on the manifest fetch", () => {
  const layout = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8")
  assert.match(layout, /rel="manifest"/)
  assert.match(layout, new RegExp(`href=\\{pwaManifestPath\\}|href="${pwaManifestPath}"`))
  assert.match(layout, /crossOrigin="use-credentials"/)
  assert.match(layout, /appleWebApp/)
  assert.match(layout, /themeColor/)
  assert.doesNotMatch(layout, /serviceWorker|service-worker|workbox|serwist/i)
  assert.match(layout, /startupImage/)
  assert.match(layout, /viewportFit:\s*"cover"/)
  assert.match(layout, /black-translucent/)
  assert.equal(pwaManifestPath, "/manifest.webmanifest")
  const worker = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8")
  assert.equal(worker, serviceWorkerSource())
  const register = readFileSync(
    path.join(process.cwd(), "components/app/pwa-client.tsx"),
    "utf8"
  )
  assert.match(register, /serviceWorker\.register\("\/sw\.js"/)

  // Next emits an uncredentialed manifest link first. Clearing it here leaves
  // the credentialed link in the root layout as the one browsers use.
  const shell = readFileSync(
    path.join(process.cwd(), "app/(workspace)/layout.tsx"),
    "utf8"
  )
  assert.match(shell, /manifest:\s*null/)
})

function exclusions(matcher: string) {
  const found = matcher.match(/\(\?!([^)]+)\)/)
  assert.ok(found, matcher)
  return found[1].split("|")
}

function proxyRuns(pathname: string) {
  const matcher = config.matcher
  assert.equal(matcher.length, 1)
  const rest = pathname.replace(/^\//, "")
  return !exclusions(matcher[0]).some(
    (prefix) => rest === prefix || rest.startsWith(prefix)
  )
}

test("startup images match the current iPhone sizes", () => {
  assert.ok(pwaStartupImages.length >= 8)
  for (const image of pwaStartupImages) {
    const file = path.join(process.cwd(), "public", image.href.slice(1))
    const { width, height } = pngSize(file)
    assert.equal(width, image.width, image.href)
    assert.equal(height, image.height, image.href)
    assert.ok(readFileSync(file).byteLength < 80 * 1024, image.href)
    assert.match(image.media, /orientation: portrait/)
  }
})

test("the host check still covers the manifest, icons and worker", () => {
  const paths = [
    pwaManifestPath,
    "/sw.js",
    ...pwaIcons.map((icon) => icon.src),
    pwaAppleTouchIcon.src,
    ...pwaStartupImages.map((image) => image.href),
  ]
  for (const pathname of paths) {
    assert.equal(proxyRuns(pathname), true, pathname)
  }
  assert.equal(proxyRuns("/favicon.ico"), false)
  assert.equal(proxyRuns("/icon.svg"), false)
  assert.equal(proxyRuns("/_next/static/chunks/app.js"), false)

  for (const pathname of paths) {
    const allowed = proxy(
      new NextRequest(`http://127.0.0.1:6796${pathname}`, {
        headers: {
          host: "127.0.0.1:6796",
          origin: "http://127.0.0.1:6796",
        },
      })
    )
    assert.equal(allowed.status, 200, pathname)

    const foreign = proxy(
      new NextRequest(`https://evil.example${pathname}`, {
        headers: { host: "evil.example" },
      })
    )
    assert.equal(foreign.status, 403, pathname)
  }

  const previous = process.env.XIRYN_ALLOWED_HOSTS
  process.env.XIRYN_ALLOWED_HOSTS = "xiryn.example.com"
  try {
    const res = proxy(
      new NextRequest(`https://xiryn.example.com${pwaManifestPath}`, {
        headers: {
          host: "xiryn.example.com",
          origin: "https://xiryn.example.com",
        },
      })
    )
    assert.equal(res.status, 200)
  } finally {
    if (previous === undefined) delete process.env.XIRYN_ALLOWED_HOSTS
    else process.env.XIRYN_ALLOWED_HOSTS = previous
  }
})
