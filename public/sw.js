'use strict'
const POLICY = {"staticPrefixes":["/_next/static/"],"staticFiles":["/icon-192.png","/icon-512.png","/icon-512-maskable.png","/apple-touch-icon.png","/icon.svg","/logo.svg","/favicon.ico","/manifest.webmanifest"],"staticDirs":["/startup/"],"shellExact":["/","/agents","/routines","/skills","/templates"],"shellPrefixes":[],"apiReads":[],"denyExact":["/settings","/usage","/search","/sw.js"],"denyPrefixes":["/settings/","/api/","/usage/","/search/","/a/","/s/"],"denyFragments":["vault","secret","token","approval","password","credential"],"precache":["/icon-192.png","/icon-512.png","/icon-512-maskable.png","/apple-touch-icon.png","/logo.svg","/manifest.webmanifest"]}
const STATIC_CACHE = "xiryn-static-v1"
const SHELL_CACHE = "xiryn-shell-v1"
const KEEP = [STATIC_CACHE, SHELL_CACHE]

function decideCache(url,method,policy){if(method!=="GET")return"deny";let parsed;try{parsed=new URL(url,"https://xiryn.local")}catch{return"deny"}if(parsed.username||parsed.password)return"deny";if(parsed.search){const params=new URLSearchParams(parsed.search);for(const key of params.keys()){if(key!=="_rsc")return"deny"}}const path=parsed.pathname;if(path.includes("..")||path.includes("//"))return"deny";const lower=path.toLowerCase();for(const fragment of policy.denyFragments){if(lower.includes(fragment))return"deny"}if(policy.apiReads.includes(path))return"shell";if(policy.denyExact.includes(path))return"deny";for(const prefix of policy.denyPrefixes){if(path.startsWith(prefix))return"deny"}if(policy.staticFiles.includes(path))return"static";for(const prefix of policy.staticPrefixes){if(path.startsWith(prefix))return"static"}for(const dir of policy.staticDirs){if(path.startsWith(dir)&&path.endsWith(".png"))return"static"}if(policy.shellExact.includes(path))return"shell";for(const prefix of policy.shellPrefixes){if(path.startsWith(prefix))return"shell"}return"deny"}

function shouldStoreResponse(status,headerNames){if(status!==200)return false;const blocked=new Set(["set-cookie","www-authenticate","authorization"]);for(const name of headerNames){if(blocked.has(name.toLowerCase()))return false}return true}

function shouldClearCaches(status){return status===401}

function anonymous(url) {
  return new Request(url, { method: "GET" })
}

async function clearAll() {
  const keys = await caches.keys()
  await Promise.all(keys.map((key) => caches.delete(key)))
  const clients = await self.clients.matchAll({ includeUncontrolled: true })
  for (const client of clients) client.postMessage({ type: "caches-cleared" })
}

async function store(cacheName, url, response) {
  const names = []
  response.headers.forEach((_, name) => names.push(name))
  if (!shouldStoreResponse(response.status, names)) return
  const headers = new Headers(response.headers)
  headers.delete("set-cookie")
  headers.delete("www-authenticate")
  headers.delete("authorization")
  const body = await response.clone().blob()
  const clean = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
  const cache = await caches.open(cacheName)
  await cache.put(anonymous(url), clean)
}

async function network(request) {
  const response = await fetch(request)
  if (shouldClearCaches(response.status)) await clearAll()
  return response
}

async function fromCache(url) {
  return caches.match(anonymous(url))
}

async function handle(request) {
  const verdict = decideCache(request.url, request.method, POLICY)
  if (verdict === "static") {
    const cached = await fromCache(request.url)
    if (cached) return cached
    try {
      const response = await network(request)
      if (response.ok) await store(STATIC_CACHE, request.url, response)
      return response
    } catch (error) {
      const fallback = await fromCache(request.url)
      if (fallback) return fallback
      throw error
    }
  }
  if (verdict === "shell") {
    try {
      const response = await network(request)
      if (response.ok) await store(SHELL_CACHE, request.url, response)
      return response
    } catch (error) {
      const fallback = await fromCache(request.url)
      if (fallback) return fallback
      throw error
    }
  }
  return network(request)
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        for (const path of POLICY.precache) {
          const response = await fetch(path)
          if (response.ok) {
            await store(STATIC_CACHE, new URL(path, self.location.origin).href, response)
          }
        }
      } catch {
        // Icons can be fetched on the first online launch.
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(handle(event.request))
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear") event.waitUntil(clearAll())
})

self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }
  const title =
    typeof payload.title === "string" && payload.title ? payload.title : "Xiryn"
  const body = typeof payload.body === "string" ? payload.body.slice(0, 180) : ""
  const href =
    typeof payload.href === "string" && payload.href.startsWith("/") && !payload.href.startsWith("//")
      ? payload.href
      : "/"
  const tag = typeof payload.tag === "string" ? payload.tag.slice(0, 64) : "xiryn"
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { href },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const href = event.notification.data && event.notification.data.href
  const target =
    typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : "/"
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of clients) {
        const page = new URL(client.url)
        if (page.origin !== self.location.origin) continue
        await client.focus()
        client.postMessage({ type: "open", href: target })
        return
      }
      await self.clients.openWindow(target)
    })()
  )
})
