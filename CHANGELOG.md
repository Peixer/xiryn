# Changelog

All notable changes to Xiryn are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **File attachments in the composer.** Up to 10 files, 25 MB each, streamed into the agent's workstation at `~/uploads`. The thread shows the name and size (and an image thumbnail). Image bytes go to the model only when that model is known to accept them.
- **Skills.** Reusable playbooks in `data/skills/<slug>/SKILL.md`, edited on the Skills page (create, edit, delete, import, export). Each turn includes a catalog of up to 40 names and descriptions; the agent loads the full text with `skill_read` and cannot write skills. A skill is prompt text, shown in the page before use, and is never executed as a script. Files that don't parse are skipped with a warning. Each file is at most 16 KB, and the library holds 64.
- **Notification webhook.** Settings can POST a short message when a task finishes, fails, or needs approval, a takeover, or a secret — including on a headless machine. Formats are ntfy, Slack, and JSON. The URL is http(s) only, masked in the UI, and never logged. Reply previews are off unless you opt in, and then capped at 140 characters. Nothing is sent until a URL is set.
- **Webhook-triggered routines.** `POST /api/hooks/routines/<id>` with `Authorization: Bearer <token>` (or `X-Xiryn-Token`) starts that routine. The token is the secret setting `hooks.token` (`XIRYN_HOOKS_TOKEN`); unset, the route is 404. The body, capped at 64 KB, is given to the agent as untrusted data. Approvals are unchanged. About 30 requests a minute, then 429.
- **Per-agent monthly budget.** Usage → spend controls can cap one agent (a research agent on an expensive model, say) without lowering the monthly budget for the others. At the start of a turn, if that agent's month-to-date spend has reached its limit, the turn waits with the same response as the global budget. Local and unpriced models are never held. A turn recorded for a delegate counts toward that delegate.
- **Bedrock prompt caching.** Claude and Nova calls on Bedrock now carry cache checkpoints after the system prompt and after the last message, so a tool loop reads its unchanged prefix back from Bedrock's cache at the cached-input rate instead of paying full price on every step. The cache stays inside the same AWS account and region. `XIRYN_PROMPT_CACHE=off` turns it off. The context compaction window now moves in chunks of six results instead of one per step, so old results are rewritten once per chunk and the prefix stays byte-identical in between (the cache would miss every step otherwise).
- **OpenRouter Claude prompt caching.** Claude models sent through OpenRouter (`openrouter/anthropic/…`) carry a top-level `cache_control: { type: "ephemeral" }`, OpenRouter's automatic breakpoint, which moves forward as the conversation grows. Other OpenRouter models are left alone; they cache on their own. The same `XIRYN_PROMPT_CACHE=off` switch turns it off.
- **Bedrock models in another region.** `XIRYN_BEDROCK_EXTRA_REGIONS=us-east-2` lists that region's models and calls Llama 3.3 70B Instruct on-demand in Ohio (`bedrock/meta.llama3-3-70b-instruct-v1:0`) while `AWS_REGION` stays `eu-west-3`. `XIRYN_BEDROCK_MODEL_REGIONS` pins any other id. Llama's card disallows tools on the streaming API, so a tool step uses Converse and the reply is replayed into the chat.
- **Amazon Bedrock** as a provider. Uses the AWS credential chain (an EC2 instance role, with no keys stored) or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`. Region defaults to `eu-west-3` and is what turns Bedrock on when you are not pasting keys. EU inference profiles for Claude Sonnet and Haiku and for Nova Pro, Lite and Micro are in the picker. Streaming and tool calling go through the same path as the other providers.
- **MCP connectors**, plus built-in Gmail and Google Calendar. Configure other servers (stdio or streamable HTTP) in `data/mcp.json` or Settings → Connectors. Sends and other writes wait for approval in the thread or on Telegram. Google OAuth finishes at `https://<host>/api/google/oauth/callback`. See [docs/mcp.md](docs/mcp.md).
- **Server deploy files** in `deploy/` and [docs/aws.md](docs/aws.md): systemd, Caddy with basic auth (including the chat stream and the desktop websocket), and `deploy.sh`.

### Fixed

- Bedrock output tokens follow the model. Nova Pro, Lite and Micro stay at 10,000 (a 16,384 request is rejected) and Llama 3.3 70B at 4,096. Claude still asks for 16,384. Override with `XIRYN_BEDROCK_MAX_OUTPUT`.
- Next.js 16.4.0 → 16.4.2, including `eslint-config-next`. Closes GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, and CVE-2026-94482 (GHSA-p3m5-59mp-jv5r).
- Llama 3.3 on Bedrock was answering with a tool call written as text, so the tool never ran. Text-form calls (`type: function`, `name`/`parameters`, `<|python_tag|>`, code fences) are now executed, then the turn continues.
- Firecrawl's connection test no longer treats a self-hosted server as down when `/v2/team/credit-usage` errors. It scrapes example.com instead and reports `connected (self-hosted, no credit info)`. The cloud credit check is unchanged.

## [0.5.1] — 2026-10-20

Fixes from running 0.5.0 end to end with a real Ollama on Windows.

### Fixed

- **Local models no longer lose their instructions.** Ollama runs models with a small context unless told otherwise (4K on an 8 GB graphics card) and quietly cut Xiryn's agent prompt in half, so agents forgot the question. Xiryn now saves a 32K context on the models it downloads or makes the default (16K under 12 GB of memory), checks any other Ollama model once before its first turn, and Settings → Local models shows each model's context with a one-click fix.
- `npm run background -- stop` on Windows no longer stops Ollama or Docker Desktop when Xiryn had started them; it ends only Xiryn's own processes.
- A routine's run now delivers the result instead of replying that it's scheduled, even on small local models: the agent reads each run as due now, and routines created from a chat describe one run rather than the schedule.
- `npm run setup:local` downloads the model through Ollama's API when Ollama is running but its command isn't on the PATH (a portable copy, say), instead of stopping.
- Download progress in Settings → Local models counts the whole model rather than one layer at a time.

## [0.5.0] — 2026-10-20

Routines, free local models in one command, and what every reply costs.

### Added

- **Routines:** tasks agents do on their own on a schedule — every day, on weekdays, one day a week, every few hours, or just once — in your computer's local time. Set them up on the new **Routines** page (with ideas to start from: a morning brief, job alerts, a price watch, a weekly research digest, a plan for the week), or just ask an agent in a chat: *"every weekday at 9, check…"*. Each routine posts into its own thread; you're told when a run finishes in the app, on Telegram (every run, however short) and by your desktop.
- **Agents can schedule:** new `routine_create`, `routine_list` and `routine_delete` tools. Agents now also know the local date, time and time zone.
- **Background mode:** `npm run background` runs Xiryn with no terminal or browser open (`stop`, `restart`, `status`), and `npm run background -- login` starts it whenever you log in (Windows, macOS and Linux). It serves a production build, rebuilt automatically after updates, and logs to `data/xiryn.log`.
- **Desktop notifications without a tab:** with no Xiryn tab open, the operating system shows a notification when an agent finishes or needs you. Off in **Settings → System** or with `XIRYN_DESKTOP_NOTIFY=off`.
- **Free local models in one command:** `npm run setup:local` (or `--local` on the one-line installers) installs Ollama if it's missing, downloads a model with tool calling and vision that fits your computer's memory, and makes it every agent's default.
- **Settings → Local models:** Ollama's status, your downloaded models, one-click downloads with progress (any model from ollama.com/library), and **Use as default**.
- **What it costs:** every reply shows its price — *free · local* on local models — from up-to-date prices for OpenAI, Anthropic and Gemini models, including long-context and cached-input rates. The Usage page adds spend by day, model and agent, estimates older turns, and lets you set a price for models Xiryn doesn't know.
- **Monthly budget:** set one on the Usage page or with `XIRYN_MONTHLY_BUDGET`. Once it's spent, paid models wait until the 1st; local models keep working.
- **16 ready-made agents and 4 squads:** a new **Templates** page — Atlas, Altair (shopping), Polaris (travel), Mira (errands), Capella (jobs), Sirius (writing), Antares (social), Castor (leads), Vega (research), Deneb (news), Spica (tutor), Rigel (engineering), Arcturus (code review), Electra (websites), Lyra (data) and Pollux (budgets) — plus Crew, Launch crew, Trip team and Dev team, each created in one click. A new workspace offers the starter team straight away.
- **Feedback:** after a few finished tasks, a small card asks how Xiryn is doing; answering opens a draft in your own email app to the author (nothing is sent by Xiryn). It's also in the sidebar and the command palette, next to *Report a bug on GitHub*.
- **Export a thread:** *Copy as Markdown* and *Export as Markdown* in the thread menu, with who said what, the steps agents took, and the model and cost of each reply.

## [0.4.1] — 2026-10-12

### Changed

- **The project is now called Xiryn** — [xiryn.com](https://xiryn.com), [github.com/SouravBeraAkaSpeed/xiryn](https://github.com/SouravBeraAkaSpeed/xiryn). Everything carries the new name: the app, the `XIRYN_*` settings, the database (`data/xiryn.db`), the vault, the agents' Docker machines and volumes, and the setup scripts.

### Fixed

- The update button shows on the next page load after a push. Xiryn now asks GitHub once each time the page loads, instead of when the server starts and then every few hours.
- Settings → System showed `[object Promise]` instead of the number of agents, squads, threads, messages and memories.
- Next's error badge no longer appears in the corner, and attributes that browser extensions add to the page no longer cause hydration warnings.
- An agent clearing `/tmp` on its desktop no longer shuts that desktop down or locks you out of watching it.
- A thread open in the app now follows turns started from Telegram (or by answering a payment or detail request) as they happen, instead of staying blank until you reload.
- Tables in Telegram messages arrive as readable lines (a header, then one bullet per row) instead of raw `|` pipes — including the notice when a task started at the computer finishes, which used to run the whole reply into one line.

## [0.4.0] — 2026-10-11

### Added

- **Voice typing:** a mic button in the composer. Speech is recognised by the browser — on the device where the browser supports it — and lands in the box to review before sending.
- **A phone take-over page:** Telegram hand-off links open a page made for phones, with a keyboard button that types on the agent's desktop, a key bar (Enter, Backspace, Tab, Esc, arrows, Ctrl), Paste text, a countdown and Done. On an upright phone the desktop sits above the keys, clear of the keyboard.

- **Update button:** when GitHub has commits (or a release) newer than your copy, an update button next to the logo links to the README's new Updating section. The project's star count shows there too once it's past 20. Off with `XIRYN_UPDATE_CHECK=off` or in Settings → System.

### Changed

- The desktop's password in a phone link travels after the `#`, so it never reaches the tunnel's logs, and links are sent only once their address answers.

## [0.3.0] — 2026-10-11

Agents can now sign in and pay for you — with your approval every time, and without ever seeing your details.

### Added

- **Vault:** logins, cards, UPI IDs and personal details, encrypted with AES-256-GCM. The key is held by the operating system (macOS Keychain, Windows DPAPI, the Linux Secret Service). Manage it in **Settings → Vault**.
- **Agents fill without seeing:** `vault_fill` types a saved value into the page and shows the field as dots; agents only ever get masked hints. Logins fill only on their own site.
- **Payment approvals:** before paying, an agent asks with the merchant, the amount and the site. Approve with a saved card or UPI ID, pay yourself by taking over, or decline — in the chat or with one tap on Telegram. A card only fills on the site you approved, for 20 minutes.
- **Secure requests:** when an agent needs a login, a card or a one-time code, a form appears in the chat; what you enter goes into the vault, saved or for one task. Codes can be replied to the Telegram bot; the message is deleted and the code used once.
- **Set up with a coding agent:** a prompt in the README for Claude Code, Codex or Cursor that installs everything and asks for your keys.
- **Expand the live desktop** inside Xiryn, watching only, with Fullscreen and Take over.

### Fixed

- Workstations that had stopped wouldn't start again: stale X server locks are now cleared at boot.
- macOS setup: Homebrew renamed the Docker Desktop cask; setup now installs Docker Desktop, Node.js and Git without Homebrew or a password.
- Linux setup as root, and when Docker can't be started without a password.
- Chromium no longer asks to "restore pages" after a workstation restarts.

## [0.2.0] — 2026-10-11

Agents' machines now run on your own computer, in Docker. Nothing to sign up for, nothing in the cloud, and sites see your own connection.

### Changed — breaking

- **Workstations run locally in Docker.** Each agent gets its own container — a Debian desktop with Chromium, a shell, `sudo`, Node.js and Python — built on your computer from `workstation/` and fully separate from your own files and screen. Daytona is no longer used and `DAYTONA_*` settings are ignored; new `XIRYN_WORKSTATION_*` settings set CPU, memory, auto-stop and auto-delete.

### Added

- **One-command setup** for every OS: `setup.sh` (macOS, Linux) and `setup.ps1` / `setup.cmd` (Windows) install Git, Node.js and Docker if they're missing, build the agents' desktop image and start Xiryn. `npm run setup` installs and starts Docker when asked to, and `npm run workstation:build` rebuilds the image.
- **Settings → Workstations:** Docker status with a Start button, the image build with live progress, per-agent CPU and memory limits, auto-stop, auto-delete and phone links.
- **Notifications:** a chime and a desktop notification when an agent finishes, fails or needs you, even with Xiryn in the background. Toggle them from the status bar.
- **Telegram finish notices** for tasks started at the computer that take a minute or more (`XIRYN_TELEGRAM_NOTIFY=long|all|off`). Reply to carry on.
- **Phone take-over links** through a temporary Cloudflare quick tunnel to that one desktop, closed after 30 minutes.
- Workstations stop themselves when idle even while Xiryn is closed, and machines of deleted agents are cleaned up automatically.
- **Take over:** pause the agent at any moment and use its desktop yourself, then hand it back with an optional note. The agent re-reads the screen and continues from where you left it.
- **Hand-offs:** a `request_takeover` tool lets the agent stop at logins, payments, one-time codes and CAPTCHAs and explain what's left. The take-over view opens automatically.
- **Telegram hand-off notices** with a short-lived live-desktop link that works from a phone, plus a link that opens the thread in the app. Reply to continue.
- **Delete threads** from the sidebar (hover → trash) and from the thread menu, with proper rename and delete dialogs.
- `XIRYN_URL` setting for links back into the app.

### Changed

- Agents always write their findings into the reply — every option with its details — instead of pointing at the screen, which you may not be watching.
- Every desktop action returns a screenshot of its result, so browser tasks take about half the steps.
- The last step a turn is allowed answers instead of acting, so a long task always ends with what was found and what's left.
- The desktop is 1280×800, and its browser never saves passwords or cards.
- Agents browse like a person: they open a site's home page and use its own forms instead of guessing deep links.
- Context compaction inside a turn (two screenshots and six full tool outputs kept), cutting the cost of long desktop sessions by an order of magnitude.
- `web_fetch` returns up to 12,000 characters per page.

### Fixed

- Opening the thread menu on a new thread crashed with "MenuGroupContext is missing".

### Removed

- Daytona and its SDK. Sandboxes already in a Daytona account are no longer touched; delete them from its dashboard if you like.

## [0.1.0] — 2026-10-11

The first public release.

### Added

- **Agents** with a name, role, standing orders and an optional per-agent model.
- **Workstations:** one Daytona sandbox per agent with shell, filesystem and a 1024×768 desktop; provisioned on first use, auto-stop when idle, optional auto-delete.
- **Live desktop** in the workbench via noVNC, view-only by default with a take-control toggle.
- **Long-term memory** stored locally, injected into every turn, editable from the workbench.
- **Web tools** through Firecrawl: search and page-to-markdown fetch.
- **Squads:** multi-agent threads with delegation that swaps instructions, model and workstation mid-turn.
- **Multi-provider models:** OpenAI, Anthropic, Google, xAI, Groq, Mistral, DeepSeek, OpenRouter, Ollama, LM Studio and any OpenAI-compatible API, with live model discovery.
- **Durable turns** that keep running when the tab closes and re-attach on reload; stop at any time.
- **Telegram remote access** over long-polling with QR/deep-link pairing to a single owner account.
- **Usage ledger** of tokens, steps and duration per turn, by day, model and agent.
- **Settings** for every key and option, overriding `.env`, with connection tests.
- **Security:** loopback-only server, Host/Origin guard, masked secrets.
- Constellation glyphs for agents and squads, dark and light themes, command palette (⌘K), responsive layout.

[0.5.1]: https://github.com/SouravBeraAkaSpeed/xiryn/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/SouravBeraAkaSpeed/xiryn/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/SouravBeraAkaSpeed/xiryn/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/SouravBeraAkaSpeed/xiryn/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/SouravBeraAkaSpeed/xiryn/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SouravBeraAkaSpeed/xiryn/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SouravBeraAkaSpeed/xiryn/releases/tag/v0.1.0
