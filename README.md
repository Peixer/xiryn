<p align="center">
  <img src="docs/assets/banner.png" alt="Oryn — the open-source Muse, Grok Bot and Dots, on your machine" width="100%">
</p>

<h1 align="center">Oryn</h1>

<p align="center">
  <strong>The open-source Muse, Grok Bot &amp; Dots — on your machine, with your keys.</strong><br>
  AI agents that do real work on their <em>own</em> Linux computers — never on yours.<br>
  Your data stays on your disk. Bring any model. Text your agents from anywhere.
</p>

<p align="center">
  <a href="https://github.com/SouravBeraAkaSpeed/oryn/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/SouravBeraAkaSpeed/oryn/ci.yml?branch=main&style=flat-square&label=CI&labelColor=0b0e14"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-7cc4ff?style=flat-square&labelColor=0b0e14"></a>
  <a href="https://github.com/SouravBeraAkaSpeed/oryn/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/SouravBeraAkaSpeed/oryn?style=flat-square&color=7cc4ff&labelColor=0b0e14"></a>
  <img alt="Node 20.9+" src="https://img.shields.io/badge/node-%E2%89%A520.9-7cc4ff?style=flat-square&labelColor=0b0e14">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-7cc4ff?style=flat-square&labelColor=0b0e14"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#why-oryn">Why Oryn</a> ·
  <a href="#how-it-compares">Compare</a> ·
  <a href="docs/telegram.md">Telegram</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="docs/assets/workstation.png" alt="An Oryn agent browsing on its own sandboxed desktop while the transcript streams its tool calls" width="100%">
</p>

---

This year every major lab shipped a personal agent that works on a cloud machine for you — **Muse** from Meta, **Grok Bot** from xAI, **Dots** from OpenAI. They're impressive. They're also closed, gated behind subscriptions, and they run on someone else's servers with your conversations, your logins and — when they shop for you — your payment details.

**Oryn is the same idea as one open-source app you run yourself.** Clone it, add your API keys, and you have a team of agents that each own a sandboxed Linux workstation, remember what matters, browse and research the web, write and run code, and hand work to one another. Nothing is stored anywhere but your computer, and you can message them from your phone.

```bash
git clone https://github.com/SouravBeraAkaSpeed/oryn.git && cd oryn
npm install && npm run setup     # creates .env — add your keys
npm run dev                      # → http://127.0.0.1:6796
```

## Why Oryn

**🔒 Private by design.** No account, no sign-up, no payment details — ever. Conversations, memory, settings and keys live in a single SQLite file on your disk. The only things that leave your machine are the calls you configure (your model provider, Daytona, Firecrawl, Telegram). Run a local model through Ollama and not even your prompts leave.

**🖥️ It never touches your computer.** Every agent works on its **own** Linux sandbox — shell, files, browser and a full desktop — in *your* Daytona account. It doesn't move your mouse, take over your screen or read your files. Watch a movie, play a game or keep coding while it works. Or watch it work, live, and take the wheel whenever you want.

**📱 Control it from anywhere.** Pair Telegram in two minutes — scan a QR code and you're done. No public URL, no tunnel, no port forwarding: Oryn polls Telegram from your machine. Your agents answer from wherever you are, with live progress and screenshots.

**🧠 Any model, your keys.** OpenAI, Anthropic, Google, xAI, Groq, Mistral, DeepSeek, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint. Pick a model per agent. No subscription — you pay providers directly for what you use.

**🗑️ Disposable machines.** Reset an agent and its sandbox is destroyed. Delete it and it's gone. Turn on auto-delete and workstations vanish after every session — while the agent's memory stays safe on your disk.

**👥 Agents that work as a team.** Put several agents in a squad. Ask any of them; they delegate to whoever fits the job — each on its own model and its own machine.

## How it compares

|  | **Oryn** | Hosted agents<br><sub>Muse · Grok Bot · Dots</sub> | Local computer-use agents<br><sub>e.g. OpenClaw</sub> |
| --- | --- | --- | --- |
| Source | ✅ Open source (MIT) | ❌ Closed | ✅ Open source |
| Where the agent works | Its own cloud sandbox | Vendor's cloud computer | Your computer |
| Uses your mouse, screen or files | **Never** | No — vendor cloud | Yes — shell, files and apps on your machine |
| Where your data lives | **Your disk** | Vendor's servers | Your disk |
| Account required | **No** | Yes | No |
| Card on file to shop for you | **Never** — you pay by taking control | Supported by some | Depends on setup |
| Models | **Any — 11 providers, incl. local** | The vendor's own | Many |
| Remote control | Telegram | Vendor apps & integrations | Chat apps |
| Price | **Free** + pay-as-you-go APIs | Paid plans / subscriptions | Free + APIs |

<sub>Based on public launch coverage as of October 2026. These products move fast — corrections welcome.</sub>

## Features

<table>
<tr>
<td width="50%" valign="top">

**Agents with a job**<br>
Name, role, standing orders, and a model of their own. Start from templates or write your own.

**A workstation per agent**<br>
A persistent Daytona sandbox with shell, filesystem and a 1024×768 desktop — created on first use, auto-stopped when idle.

**Live desktop, take over any time**<br>
Watch the agent click and type in real time. Hit **Take over** and it pauses; hand it back with a note and it picks up from what you did.

</td>
<td width="50%" valign="top">

**Long-term memory**<br>
Agents save what matters about you and your work; every thread sees it. Inspect, add or delete notes any time.

**Web research**<br>
Search and clean page reading through Firecrawl, with cited sources.

**Durable turns**<br>
Close the tab mid-task — the agent keeps going. Reopen and you're re-attached to the live stream. Stop it any time.

</td>
</tr>
</table>

<p align="center">
  <img src="docs/assets/engineer.png" alt="An engineer agent writes and runs a Python script in its sandbox" width="49%">
  <img src="docs/assets/squad.png" alt="In a squad, the engineer delegates a writing task to the writer agent" width="49%">
</p>
<p align="center">
  <img src="docs/assets/memory.png" alt="Research with cited sources and the agent's long-term memory panel" width="49%">
  <img src="docs/assets/overview.png" alt="Overview with system check and agents" width="49%">
</p>

## What can it do?

Anything that can be done with a terminal, a browser and a desktop — while you get on with your day:

- **Build and debug** — clone a repo, install, run the tests, fix what fails, show you the diff.
- **Research** — search, read primary sources, and come back with a cited summary.
- **Write** — launch posts, docs, reports, saved as files on its workstation.
- **Work the web** — fill forms, compare options, prepare a booking or an order. When a site needs your login, a payment or a CAPTCHA, the agent **stops and hands you the screen**; your card never touches Oryn.
- **Run as a team** — ask a squad, and the right specialist takes it.

Agents ask when they need a decision, confirm before anything irreversible, and remember what you tell them.

### You can always take the wheel

- **Take over** — one click pauses the agent and gives you its desktop. Type, click, fix what it got wrong. **Hand back** with an optional note ("I picked the 6:40 flight") and the agent looks at the screen and continues from there.
- **Hand-offs** — at a login, a payment page, a one-time code or a CAPTCHA, the agent stops by itself and tells you exactly where it is and what's left. The take-over view opens on your screen, and if Telegram is paired you get a message with a **live link to the desktop that works from your phone**. Pay on the agent's screen, reply "done", and it wraps up.
- **Browses like a person** — agents open a site's home page and use its own search forms and filters instead of guessing deep links, so you can follow along and step in at any point.

> **Note on browsing.** Agents can always read any page through Firecrawl. Driving arbitrary websites in the sandbox's own browser needs a Daytona organization with full internet access — lower Daytona tiers limit sandboxes to essential services (GitHub, package registries, AI APIs). The **Machine** tab has a one-click test.

## Quick start

**You need:** Node.js 20.9+ and a key for at least one model provider. [Daytona](https://app.daytona.io) (workstations) and [Firecrawl](https://www.firecrawl.dev) (web) are optional but are what make agents capable — both have free tiers.

```bash
git clone https://github.com/SouravBeraAkaSpeed/oryn.git
cd oryn
npm install
npm run setup
```

Add keys to `.env` — or skip this and paste them into **Settings** once Oryn is running:

```bash
OPENAI_API_KEY=sk-...          # or any other provider
DAYTONA_API_KEY=dtn_...        # agent workstations
FIRECRAWL_API_KEY=fc-...       # web search & reading
```

Run it:

```bash
npm run dev                    # development
npm run build && npm start     # production
docker compose up -d           # or in Docker
```

Open **<http://127.0.0.1:6796>** and deploy your first agent. *(6796 spells O-R-Y-N on a phone keypad.)*

## Remote control from Telegram

<img src="docs/assets/telegram.png" alt="Telegram remote access setup in Settings" width="100%">

1. In Telegram, message **@BotFather** → `/newbot` → copy the token.
2. Paste it in **Settings → Remote access**.
3. Scan the QR code with your phone and tap **Start**.

Done — only your account can use the bot.

```
/agents   pick an agent or squad      /new     start a fresh thread
/stop     interrupt the agent         /status  what's running
```

When an agent needs you — a payment, a login, a code — the bot pings you with a live link to the agent's desktop. Finish the step from your phone, reply "done", and the agent carries on.

Full walkthrough: **[docs/telegram.md](docs/telegram.md)**.

## Architecture

```mermaid
graph LR
    you([You · browser]) -->|localhost| app
    phone([You · Telegram]) -.->|Bot API| tg[Telegram]
    tg -.->|long-poll from your machine| app

    subgraph machine [Your computer]
        app[Oryn · Next.js server]
        app --> runtime[Agent runtime]
        app --> db[(SQLite · data/oryn.db)]
        runtime --> db
    end

    runtime -->|your key| llm[Model provider]
    runtime -->|your key| daytona[Daytona · one sandbox per agent]
    runtime -->|your key| firecrawl[Firecrawl]
    you -->|live desktop · noVNC| daytona
```

One process, one file. The Next.js server serves the UI, runs agent turns in-process through the [AI SDK](https://ai-sdk.dev), and owns the SQLite database — no queue, no worker, no backend of ours. Details in **[docs/architecture.md](docs/architecture.md)**.

| Path | What lives there |
| --- | --- |
| `lib/agent/` | Runtime, tool belt, instruction builder |
| `lib/providers/` | Provider catalog, model factory, live model discovery |
| `lib/telegram/` | Bot API client, formatter and the bridge |
| `lib/workstation.ts`, `lib/web.ts` | Daytona and Firecrawl |
| `db/` | Drizzle schema and migrations |
| `app/`, `components/` | The interface |

## Configuration

Every setting can come from `.env` **or** from **Settings** in the app. Values saved in the app win, are stored only in `data/oryn.db`, and are shown back to the browser masked. The annotated list is in [`.env.example`](.env.example); providers are covered in [docs/providers.md](docs/providers.md).

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` | Hosted model providers |
| `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, `CUSTOM_BASE_URL` | Local runtimes and any OpenAI-compatible API |
| `ORYN_DEFAULT_MODEL`, `ORYN_MAX_STEPS` | Default `provider/model`, max tool calls per turn |
| `DAYTONA_API_KEY`, `DAYTONA_TARGET` | Agent workstations |
| `DAYTONA_AUTO_STOP_MINUTES`, `DAYTONA_AUTO_DELETE_MINUTES` | Idle stop; disposable sandboxes |
| `FIRECRAWL_API_KEY` | Web search and reading |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID` | Remote access |
| `ORYN_DATA_DIR`, `ORYN_ALLOWED_HOSTS` | Data location; extra hostnames behind your own proxy |
| `ORYN_URL` | Where you open Oryn, for links in Telegram hand-offs |

## Security & privacy

Oryn has no user accounts, so it's built never to be reachable by anyone but you:

- Binds to **127.0.0.1** only, and refuses any request whose `Host` or `Origin` isn't loopback — which also blocks DNS-rebinding attacks from web pages you visit.
- API keys never reach the browser; the UI only sees masked values, and keys are kept out of logs.
- Telegram answers exactly **one** paired account; pairing codes are single-use and rotate after wrong guesses.
- Agents execute only inside their sandboxes, never on your machine — and never hold your passwords or cards.
- No telemetry. No analytics. No calls home.

See [SECURITY.md](SECURITY.md) for the full model and how to report a vulnerability.

## FAQ

**Does an agent control my computer?**
No. Everything an agent does — commands, files, mouse, keyboard, browser — happens inside its own cloud sandbox. Your machine only runs the lightweight Oryn server, so you can keep using it normally.

**Can it book a flight or order something?**
It can do the legwork on real websites — search, compare, fill in the details — and it will ask before anything irreversible. Logins and payments are yours: the agent hands you its screen for that step (in the app, or from your phone through Telegram), so Oryn never stores credentials or cards. Driving arbitrary sites requires a Daytona plan with full internet access (see the note above).

**How do I delete a thread?**
Hover it under **Recent threads** in the sidebar and click the trash icon, or open the thread menu (⋯) in its header → **Delete thread**. The agent, its memory and its workstation stay.

**Where is my data?**
In `data/oryn.db` on your disk. Back it up by copying the file; erase everything by deleting it.

**Does it work without Daytona or Firecrawl?**
Yes. Agents then chat, remember and (with Firecrawl) research, but can't run code or use a desktop. The app tells you what's missing.

**Can I use only local models?**
Yes — point `OLLAMA_BASE_URL` or `LMSTUDIO_BASE_URL` at your runtime and pick a model with tool calling.

**What does it cost?**
Oryn is free and MIT-licensed. Your model provider, Daytona and Firecrawl bill you directly; the **Usage** page shows tokens per model and agent.

## Roadmap

Ideas we're exploring — not shipped yet. Have opinions? [Open an issue](https://github.com/SouravBeraAkaSpeed/oryn/issues/new/choose).

- [ ] Scheduled and recurring tasks — standing goals that run while you sleep
- [ ] More remote channels: WhatsApp, Discord, Slack
- [ ] MCP connectors for email, calendar and docs
- [ ] A fully local sandbox backend (Docker) for offline workstations
- [ ] Voice in and out
- [ ] Shareable agent templates

## Contributing

Contributions are welcome — from typo fixes to new providers. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)**, and please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

```bash
npm run check    # typecheck + lint + format
npm run build
```

## Star history

<a href="https://star-history.com/#SouravBeraAkaSpeed/oryn&Date">
  <img src="https://api.star-history.com/svg?repos=SouravBeraAkaSpeed/oryn&type=Date" alt="Star history" width="100%">
</a>

## Author

Built by **[Sourav Bera](https://souravbera.vercel.app)**.
If Oryn is useful to you, a ⭐ helps other people find it.

## License

[MIT](LICENSE) © 2026 Sourav Bera

<sub>Muse, Grok Bot, Dots and OpenClaw are trademarks of their respective owners. Oryn is an independent project and is not affiliated with or endorsed by Meta, xAI, OpenAI or the OpenClaw project.</sub>
