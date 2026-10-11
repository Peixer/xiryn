# Changelog

All notable changes to Oryn are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/SouravBeraAkaSpeed/oryn/releases/tag/v0.1.0
