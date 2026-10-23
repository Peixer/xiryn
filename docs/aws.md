# Running Xiryn on AWS (EC2, eu-west-3)

One person, one Ubuntu 24.04 instance, Caddy in front with HTTPS and basic auth. The app itself keeps listening on `127.0.0.1:6796`. These files assume the checkout is `/opt/xiryn`, which matches a host that was already being prepared. They do not require that path: `deploy/deploy.sh` uses `XIRYN_ROOT` when it is set.

This fork is `Peixer/xiryn`. Point the checkout at it before the first pull. Do not push this tree at the upstream `SouravBeraAkaSpeed/xiryn`.

```bash
cd /opt/xiryn
git remote set-url origin https://github.com/Peixer/xiryn.git
git fetch origin
git checkout main
git pull --ff-only
```

## Instance

A t3.2xlarge-sized box (8 vCPU, 32 GB) in **eu-west-3** is enough for the app, a few agent desktops, and Bedrock calls leaving the machine. The security group should allow **22** from your IP and **80/443** from the internet. Nothing else needs to be public: the app, the desktop proxy and every agent's VNC port bind to loopback.

Install, as root or with sudo:

```bash
apt-get update
apt-get install -y git curl ca-certificates debian-keyring debian-archive-keyring
# Node.js 22 — https://github.com/nodesource/distributions
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
# Docker, for agent workstations — https://docs.docker.com/engine/install/ubuntu/
# Caddy — https://caddyserver.com/docs/install#debian-ubuntu-raspberry-pi-os
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
apt-get install -y caddy
```

Create the service user and let it talk to Docker:

```bash
useradd --system --create-home --home-dir /var/lib/xiryn --shell /usr/sbin/nologin xiryn || true
usermod -aG docker xiryn
chown -R xiryn:xiryn /opt/xiryn
```

## Bedrock role

Attach an instance profile. No access keys.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "XirynBedrock",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListInferenceProfiles",
        "bedrock:GetInferenceProfile",
        "bedrock:ListFoundationModels"
      ],
      "Resource": "*"
    }
  ]
}
```

Cross-region EU profiles route to other EU regions, so the action has to be allowed in those destination regions too (the account's service control policies included). Tighten the resource ARNs later if you want; a profile-only model is invoked by its inference-profile ARN, not only the foundation-model ARN.

In the Bedrock console, region **Europe (Paris)**, submit Anthropic's first-time model access form once. Then in `/opt/xiryn/.env`:

```bash
AWS_REGION=eu-west-3
XIRYN_DEFAULT_MODEL=bedrock/eu.anthropic.claude-sonnet-5-5
```

Leave `AWS_ACCESS_KEY_ID` unset. Setting `AWS_REGION` is what turns the Bedrock provider on when there are no keys. See `docs/providers.md` for the model ids.

A model that is not served from Paris needs its region named. Llama 3.3 70B Instruct is on-demand in Ohio (`us-east-2`), and the instance role already applies in every region:

```bash
XIRYN_BEDROCK_EXTRA_REGIONS=us-east-2
```

Restart, then pick **Llama 3.3 70B (Ohio)**, id `bedrock/meta.llama3-3-70b-instruct-v1:0`. Claude Sonnet 4.6 stays `bedrock/eu.anthropic.claude-sonnet-4-6` in `eu-west-3`. Nova Pro, Lite and Micro are capped at 10,000 output tokens; Llama 3.3 at 4,096. Details are in `docs/providers.md`.

## Environment

```bash
cp /opt/xiryn/.env.example /opt/xiryn/.env
chmod 600 /opt/xiryn/.env
chown xiryn:xiryn /opt/xiryn/.env
```

Set at least:

```bash
AWS_REGION=eu-west-3
XIRYN_URL=https://xiryn.example.com
XIRYN_ALLOWED_HOSTS=xiryn.example.com
XIRYN_DATA_DIR=/opt/xiryn/data
XIRYN_DEFAULT_MODEL=bedrock/eu.anthropic.claude-sonnet-5-5
```

`XIRYN_ALLOWED_HOSTS` is required. Without it the app answers 403 for any host that is not loopback, which is the right behaviour on a laptop and the wrong one behind Caddy. The hostname is the name in the browser, no port, no scheme.

`XIRYN_URL` is that same origin with `https://`. Telegram links, the Google redirect, and the desktop stream all use it. When it is a public origin, the in-app desktop connects to `wss://<host>/desktop/<agent>/websockify` instead of a loopback port on your laptop.

Optional, so the vault key survives a home-directory change: `XIRYN_VAULT_KEY` as 32 bytes of base64. Otherwise the key file lands in the service user's home (`/var/lib/xiryn/.xiryn/`). Back that file up with the database. Losing it makes sealed Google tokens and vault items unreadable.

## systemd

```bash
sudo cp /opt/xiryn/deploy/xiryn.service /etc/systemd/system/xiryn.service
sudo systemctl daemon-reload
sudo systemctl enable --now xiryn
```

The unit runs `npm run start`, which is `next start` on `127.0.0.1:6796`. Build first (`npm run build`, or `deploy/deploy.sh`). Logs: `journalctl -u xiryn -f`.

On boot the process also listens on `127.0.0.1:6797` and forwards `/desktop/<agent>/websockify` to that agent's container. `XIRYN_DESKTOP_PROXY=off` skips it. `XIRYN_DESKTOP_PROXY_PORT` changes the port; keep the Caddyfile in step.

## Caddy

```bash
caddy hash-password
```

Put the hash in `deploy/Caddyfile` in place of the placeholder, set the hostname, then:

```bash
sudo cp /opt/xiryn/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Basic auth covers the whole site, including:

- page loads and server actions
- the chat stream (`POST /api/threads/.../turn`) and the event stream (`GET /api/events`), which stay unbuffered (`flush_interval -1`)
- the desktop websocket (`/desktop/.../websockify` → port 6797)
- the Google OAuth callback
- `POST /api/hooks/routines/<id>`, until you opt out (below)

Routine webhooks use their own bearer token, `XIRYN_HOOKS_TOKEN` (`Authorization: Bearer` or `X-Xiryn-Token`). Leave it unset and the route answers 404. The hostname in that URL has to be in `XIRYN_ALLOWED_HOSTS` or the request is 403 before the token is checked. The body is untrusted data for the agent; approvals are not skipped. `deploy/Caddyfile` comments the shape that proxies `/api/hooks/*` without basic auth. Copying it means moving `basic_auth` into a handle that does not match that path — a handle on its own does not override a site-level password. Do not put the token in the URL, and do not log it.

Phone takeover links that Xiryn opens through a Cloudflare quick tunnel still go straight to the container's noVNC page. They are not on this hostname. Turn them off with `XIRYN_PHONE_TAKEOVER=off` if you only want the Caddy path.

Point DNS at the instance and wait until `https://<host>` asks for the basic-auth user.

## Health

`GET /api/health` is the check an uptime monitor, or `curl` on the instance, can hit. It answers in under a second from the local database, the Docker daemon, and saved settings (it leaves the update checker alone). The JSON is `status` (`ok`, `degraded`, or `down`), the app version, uptime in seconds, `db.ok` (SQLite answered `select 1`), Docker (`ready`, `stopped`, `missing`, or `unknown` when the probe times out), `routines.enabled` (how many routines are switched on) and `routines.nextRunAt` (the soonest of those, or null), Telegram (`configured` when a bot token is set, otherwise `off`), and `providersConfigured`. Keys, paths, and thread contents stay out of the body.

On the box:

```bash
curl -sS localhost:6796/api/health
```

The request's Host has to be loopback or listed in `XIRYN_ALLOWED_HOSTS`, the same rule as every other route (`proxy.ts`). `localhost` is allowed, so that command works on the instance. Any other Host gets **403** until it is added to `XIRYN_ALLOWED_HOSTS`.

Caddy basic auth still covers this path with the rest of the site:

```bash
curl -sS -u 'monitor:password' https://xiryn.example.com/api/health
```

`200` means `status` is `ok` or `degraded`. Docker stopped, missing, or unanswered before the short probe timeout is `degraded` with `200`. `503` means `status` is `down`: SQLite did not answer `select 1`.

## Updating

`deploy/deploy.sh` fast-forwards the checkout, installs, builds, and restarts `xiryn`. Run it from a user who can `sudo systemctl`:

```bash
sudo /opt/xiryn/deploy/deploy.sh
```

It does not touch Caddy or the instance role. If this directory still tracks upstream, fix the remote first (see the top of this page) or the pull will not bring this fork.
