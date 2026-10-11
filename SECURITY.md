# Security Policy

Oryn runs AI agents with real capabilities — shell access in sandboxed containers, web access, a remote-control bridge — on people's own machines. Security reports are taken seriously.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | ✅ |
| Latest release | ✅ |
| Older releases | ❌ — please upgrade |

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private reporting: **Security → Report a vulnerability** on [the repository](https://github.com/SouravBeraAkaSpeed/oryn/security/advisories/new). If that isn't possible, contact the maintainer through <https://souravbera.vercel.app>.

Include what you can:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected version or commit
- Any suggested fix

You'll get an acknowledgement within **72 hours** and a first assessment within **7 days**. Fixes are released as soon as they're ready, and reporters are credited unless they prefer otherwise.

## Security model

Understanding what Oryn protects — and what it doesn't — helps you judge a finding.

**What Oryn defends**

- **Network exposure.** The server binds to `127.0.0.1`. Requests whose `Host` or `Origin` isn't loopback (or listed in `ORYN_ALLOWED_HOSTS`) are refused, which also blocks DNS-rebinding attacks from websites you visit.
- **Secret handling.** API keys and the Telegram token are read only on the server. The browser receives masked values; server-action argument logging is disabled.
- **Remote access.** The Telegram bridge answers exactly one paired account. Pairing codes are single-use and rotate after repeated wrong guesses.
- **Host isolation.** Agent tools execute inside each agent's own Docker container, as an unprivileged user with no access to your files, desktop or other containers' data. Nothing from your machine is mounted into it.
- **Live desktops.** Each container's noVNC port is published on `127.0.0.1` only and protected by a random per-container password that only the Oryn server hands to your browser. Phone take-over links (Telegram hand-offs) open a temporary Cloudflare quick tunnel to that one desktop; it closes after 30 minutes, and the link carries the password — treat it as a secret, or turn the feature off with `ORYN_PHONE_TAKEOVER=off`.

**What is out of scope or your responsibility**

- **No authentication by design.** If you expose Oryn beyond localhost, put it behind your own authenticating proxy. Doing so without one is a misconfiguration, not a vulnerability.
- **Model behavior.** Agents act on instructions, and content they read (web pages, files) can contain prompt injections. Workstations limit the blast radius to the agent's container — which can still reach the internet, from your connection — but treat agent output — and anything it does with credentials you give it — with care.
- **Third-party services.** Prompts go to the model provider you configure; Telegram messages pass through Telegram; phone take-over links pass through Cloudflare. Their security is governed by those providers.
- **Container isolation itself.** Workstations rely on Docker's isolation. A container escape is a Docker issue — report it to Docker — unless Oryn's configuration (mounts, capabilities, published ports) made it possible.
- **Local data at rest.** `data/oryn.db`, `.env` and the agents' home-folder volumes are protected by your operating system's account security.

## Hardening tips

- Keep Oryn updated.
- Use a dedicated, scoped API key per provider and set spending limits in their dashboards.
- Set `ORYN_WORKSTATION_AUTO_DELETE_MINUTES` if you want workstations to be disposable.
- Don't give agents credentials they don't need.
