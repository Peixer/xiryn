# Security Policy

Oryn runs AI agents with real capabilities — shell access in sandboxes, web access, a remote-control bridge — on people's own machines. Security reports are taken seriously.

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
- **Host isolation.** Agent tools execute inside Daytona sandboxes, not on the machine running Oryn.

**What is out of scope or your responsibility**

- **No authentication by design.** If you expose Oryn beyond localhost, put it behind your own authenticating proxy. Doing so without one is a misconfiguration, not a vulnerability.
- **Model behavior.** Agents act on instructions, and content they read (web pages, files) can contain prompt injections. Workstations limit the blast radius to the sandbox, but treat agent output — and anything it does with credentials you give it — with care.
- **Third-party services.** Prompts go to the model provider you configure; workstation contents live in your Daytona account; Telegram messages pass through Telegram. Their security is governed by those providers.
- **Local data at rest.** `data/oryn.db` and `.env` are plain files protected by your operating system's account security.

## Hardening tips

- Keep Oryn updated.
- Use a dedicated, scoped API key per provider and set spending limits in their dashboards.
- Enable `DAYTONA_AUTO_DELETE_MINUTES` if you want workstations to be disposable.
- Don't give agents credentials they don't need.
