# Install Xiryn on a home screen

The app can be installed from the https URL in front of Caddy (or from
`http://127.0.0.1:6796` on the machine that runs it) and opened full-screen,
without the browser's address bar. This is a shell only.

There is **no service worker**, no offline cache, and no push. Threads, keys,
and the vault are private. A worker would keep authenticated pages on the
device after basic auth is no longer something you want stored. Closing the
network shows the browser's own error, not a saved copy of Xiryn. Do not add
`public/sw.js`, Workbox, or Serwist.

## What is served

`app/manifest.ts` answers `GET /manifest.webmanifest`:

- name and short name `Xiryn`
- `start_url` `/`, `display` `standalone`
- `theme_color` and `background_color` `#14151a`, the same dark token the
  viewport already used. The app defaults to dark. The viewport `themeColor`
  still follows the light token `#fafbfc` when the color scheme is light. A
  manifest only has one pair.
- icons in `public/`, rasterized from `public/logo.svg`: 192 and 512
  (`purpose: any`), a maskable 512 with the glyph inside the safe zone, and
  `apple-touch-icon.png` (180)

The root layout also sets `appleWebApp` (standalone title, black status bar),
the apple touch icon, and both viewport theme colors. `appleWebApp.capable`
emits `mobile-web-app-capable`. The layout also emits
`apple-mobile-web-app-capable`, which iOS still reads if the manifest fetch
fails.

## Basic auth

Browsers request a manifest **without** cookies or HTTP authentication unless
the page's manifest link has `crossorigin="use-credentials"`. Caddy basic auth
would otherwise return 401, and Chrome would not offer install.

Next.js adds that attribute only when `VERCEL_ENV=preview`. Xiryn is
self-hosted, so `app/layout.tsx` emits its own link:

```html
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
```

`app/manifest.ts` still makes Next emit its own manifest link, and that one
has no `crossorigin` (Next adds the attribute only for Vercel preview).
Browsers use the first manifest link, so the workspace layout sets
`manifest: null` and the credentialed link in the root layout is the only
one left in the document. Icon URLs inside the manifest are fetched with
that same credentials mode.

`proxy.ts` does not exempt `/manifest.webmanifest` or the icons. A `Host` in
`XIRYN_ALLOWED_HOSTS` (see `docs/aws.md`) can load them. Any other host still
gets 403. Do not take those paths off the matcher to "fix" install: that
would answer them for a foreign host. Sign in at the real https origin, then
install. The browser keeps the basic-auth credentials for that origin and
sends them on later launches of the installed window.

A credentialed manifest fetch is same-origin here, so it does not need
`Access-Control-Allow-Origin`. The proxy allows `GET` and `HEAD` that carry
an `Origin` header. That header is how the credentialed fetch identifies
itself.

## Install

### iPhone and iPad

1. Open the https URL in Safari and sign in when Caddy asks.
2. Share, then **Add to Home Screen**.
3. The icon is `apple-touch-icon.png`. The app opens full screen.

### Android

1. Open the https URL in Chrome and sign in.
2. Menu, then **Install app** (or the install icon in the address bar).
3. The launcher uses the maskable icon. The app opens full screen.

### Desktop

1. Open the https URL in Chrome or Edge and sign in.
2. Use the install icon in the address bar, or the menu item **Install Xiryn**.
3. It opens in its own window.

DevTools → **Application** → **Manifest** should list the name, standalone
display, and the three icons, with no installability error. A Lighthouse PWA
category is not required, and this tree does not register a worker for one.
