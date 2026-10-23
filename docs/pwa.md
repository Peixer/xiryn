# Install Xiryn on a home screen

The app can be installed from the https URL in front of Caddy (or from
`http://127.0.0.1:6796` on the machine that runs it) and opened full screen,
without the browser's address bar.

On a phone-sized window, and whenever the site is installed
(`display-mode: standalone`, fullscreen, or minimal-ui), Xiryn uses an app
shell: a chat list, a full-screen conversation, and a bottom tab bar (Chat,
Agents, Routines, Settings). Below 1100px the workstation does not sit beside
the thread; the workbench button opens it over the conversation. The
side-by-side workbench is unchanged in a wider browser window.

## Offline

`public/sw.js` is generated from `lib/pwa/cache-policy.ts`. It is an app-shell
cache, not a copy of the API.

**Stored by the worker**

- Hashed build files under `/_next/static/`
- Icons, the logo, the manifest, and the iPhone startup images in `/startup/`
- The navigation documents for `/`, `/agents`, `/routines`, `/skills`, and
  `/templates` (network first, then the last copy). Next marks those documents
  `no-store`. The worker keeps them anyway so the installed app can open with
  no network. They are dropped on a 401 and when you sign out of the device.

**Not stored by the worker**

- Every `/api/` route, including `/api/health` (the route is `no-store`),
  `/api/events`, uploads, OAuth, hooks, turns, and `/api/push`. The allowlist
  of API reads is empty on purpose.
- `/settings`, `/usage`, and `/search`
- Thread documents (`/a/…`, `/s/…`). Those pages contain tool output.
- Anything whose path mentions vault, secret, token, approval, password, or
  credential
- Requests that are not GET, that carry a query other than Next's `_rsc`, or
  that embed a username or password in the URL
- Responses that are not 200, or that send `Set-Cookie`, `Authorization`, or
  `WWW-Authenticate`
- Request headers. A cached entry is stored under a GET request with no
  headers, so basic-auth credentials are not written into the Cache Storage.

A 401 (Caddy asking you to sign in again) deletes every cache and tells the
page to delete the on-device message store.

Previously opened threads are saved in IndexedDB (`xiryn-offline`) as text,
file names, and tool names. Vault tools, approval tools, secret-shaped keys,
and bearer tokens are replaced before they are written. The offline reader
says the copy is saved on the device and that nothing is running. It does not
show a working agent.

Messages written offline are an outbox (`queued`, `sending`, `sent`, `failed`).
They send when the browser comes online, when the page becomes visible, and
when the app starts. Background Sync is not used. Photos and other files are
not queued. They need a connection. A failed send can be retried from the bubble.

**Sign out of this device** (Settings in the app shell) deletes the caches and
IndexedDB, unsubscribes push, and asks the browser to replace the cached basic
auth. Caddy will prompt again.

## What is served

`app/manifest.ts` answers `GET /manifest.webmanifest`:

- name and short name `Xiryn`
- `start_url` `/`, `display` `standalone`
- `theme_color` and `background_color` `#14151a`, the same dark token the
  viewport already used. The app defaults to dark. The viewport `themeColor`
  still follows the light token `#fafbfc` when the color scheme is light, and
  a small client sync updates the tag to the theme you actually picked. A
  manifest only has one pair.
- icons in `public/`, rasterized from `public/logo.svg`: 192 and 512
  (`purpose: any`), a maskable 512 with the glyph inside the safe zone, and
  `apple-touch-icon.png` (180)
- iPhone startup images are not in the manifest. The root layout passes them
  as `appleWebApp.startupImage` (`apple-touch-startup-image`) for current
  portrait sizes, from iPhone 16 Pro Max down to SE.

The root layout also sets `appleWebApp` (standalone title, `black-translucent`
status bar so the page can pad for the notch and the home indicator), the
apple touch icon, `viewport-fit=cover`, and `interactive-widget=resizes-content`.
`appleWebApp.capable` emits `mobile-web-app-capable`. The layout also emits
`apple-mobile-web-app-capable`, which iOS still reads if the manifest fetch
fails.

The composer uses 16px type on a phone so Safari does not zoom the page. The
shell uses `100dvh`, `env(safe-area-inset-*)`, and `visualViewport` so the
composer sits above the keyboard. The page itself does not rubber-band. Lists
pull to refresh. The Vibration API is called for a short tap where the browser
has it. Safari does not, so those taps are silent.

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

`proxy.ts` does not exempt `/manifest.webmanifest`, `/sw.js`, or the icons. A
`Host` in `XIRYN_ALLOWED_HOSTS` (see `docs/aws.md`) can load them. Any other
host still gets 403. Do not take those paths off the matcher to "fix" install:
that would answer them for a foreign host. Sign in at the real https origin,
then install. The browser keeps the basic-auth credentials for that origin and
sends them on later launches of the installed window.

A credentialed manifest fetch is same-origin here, so it does not need
`Access-Control-Allow-Origin`. The proxy allows `GET` and `HEAD` that carry
an `Origin` header. That header is how the credentialed fetch identifies
itself.

## Install

### iPhone and iPad

iOS has no install prompt. In Safari, while you are not yet installed, the app
shell shows the steps. You can open them again from Settings.

1. Open the https URL in Safari and sign in when Caddy asks.
2. Share, then **Add to Home Screen**.
3. The icon is `apple-touch-icon.png`. The startup image matches the phone.
   The app opens full screen.

Web Push on iOS requires 16.4 or later **and** the home-screen app. Set the
keys below or alerts stay inside the open app. Face ID is not offered as an
app lock: a local prompt would not protect cached pages, and it would look
like a login. Caddy basic auth stays the login.

### Android

1. Open the https URL in Chrome and sign in.
2. Menu, then **Install app** (or the install icon in the address bar).
3. The launcher uses the maskable icon. The app opens full screen.

### Desktop

1. Open the https URL in Chrome or Edge and sign in.
2. Use the install icon in the address bar, or the menu item **Install Xiryn**.
3. The installed window uses the app shell. A wide browser tab keeps the
   workbench.

## Push

Nothing is sent until both keys exist. Generate a pair once and put it in
`.env` (or the process environment). Do not commit it.

```bash
npx web-push generate-vapid-keys
```

```
XIRYN_VAPID_PUBLIC_KEY=
XIRYN_VAPID_PRIVATE_KEY=
XIRYN_VAPID_SUBJECT=mailto:you@example.com
```

`XIRYN_VAPID_SUBJECT` is a `mailto:` or `https:` contact. It defaults to
`mailto:xiryn@localhost`. The private key is an internal secret: it is never
returned to the browser. Subscriptions are written to
`data/push-subscriptions.json` (mode 0600) and are not cached by the worker.
The payload is a title, a short redacted body, and a same-origin path. It does
not include tool output or approval tokens.

## Other device features

These are used when the browser has them, and skipped when it does not.

- Badging API: the home-screen icon counts threads with an unread finish or an
  approval. Opening that thread clears it.
- Web Share: share a conversation, or a file you just attached, when
  `navigator.share` / `canShare` says so.
- Camera: the composer can take a photo with `input capture="environment"`.
- Voice typing: the existing speech-recognition button. Unsupported browsers
  hide it.
- Screen Wake Lock: while an agent turn is actually streaming in the app shell.
  A queued offline message does not hold the screen awake.
