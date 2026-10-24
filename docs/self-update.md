# Updating Xiryn from the app

Xiryn can build the next version beside the one that is serving, then switch after you approve it. The app process does not restart itself and it does not get a general sudo rule. A root oneshot, started by a path unit, is the only thing that fetches, builds, migrates, and reloads Caddy.

Two colours run on the same machine:

| | Blue | Green |
| --- | --- | --- |
| Code | `/opt/xiryn-blue` | `/opt/xiryn-green` |
| Database | `/var/lib/xiryn/colours/blue` | `/var/lib/xiryn/colours/green` |
| App port | `127.0.0.1:6796` | `127.0.0.1:6896` |
| Desktop proxy | `127.0.0.1:6797` | `127.0.0.1:6897` |
| systemd | `xiryn-blue.service` | `xiryn-green.service` |

The vault key (`/etc/xiryn/vault`) and the shared environment file (`/etc/xiryn/shared.env`, mode 640, group `xiryn`) are not writable by the service. API keys stay in that shared file. Each colour has its own SQLite file. Caddy sends the public hostname to the active colour. The inactive colour is on port 8443 with the same basic auth (`deploy/Caddyfile.bluegreen`).

systemd applies every `EnvironmentFile=` after `Environment=`, and a later file replaces the same key in an earlier file. The installer copies the old `/opt/xiryn/.env` into `shared.env`, and that file sets `XIRYN_DATA_DIR=/opt/xiryn/data`. Both colours would then open the same database, on a path the colour sandbox does not make writable. The installer removes `XIRYN_DATA_DIR`, `XIRYN_PORT`, `XIRYN_DESKTOP_PROXY_PORT`, and `XIRYN_VAULT_KEY_DIR` from `shared.env`. It writes `/etc/xiryn/blue.env` and `/etc/xiryn/green.env`, and each unit loads `shared.env` first and its own file second. The colour file sets the data directory, both ports, the vault-key directory, and `XIRYN_DEPLOY_DIR`.

`/etc/xiryn-deploy.conf` names the branch (yours is `BRANCH=main`). The helper fetches that one branch through the bare mirror `/var/lib/xiryn-pin.git` and will only build the commit that branch points at. A tag, a short name, or another branch is refused. The install script creates that mirror, root-owned and world-readable, when it is missing. The helper does not.

Git, npm, and node that touch a colour tree or its database run as the `xiryn` user. The oneshot is still root, and it drops with `setpriv` (no new privileges, no capabilities) before those commands. The allow-list only accepts that fixed wrapper, so npm install scripts are not root and the checkout, `node_modules`, `.next`, and `xiryn.db` are owned by `xiryn`. Fetching the mirror, reloading Caddy, and starting the units stay root. A database snapshot also copies subdirectories such as `skills/`. It still skips `backups/`, `vault*`, `*.key`, and `.env`.

`xiryn-deploy.service` keeps `ProtectHome=read-only`, so npm and Next cannot write `~/.npm` or `~/.cache`. The helper sets `npm_config_cache=/var/lib/xiryn/deploy/npm-cache`, `XDG_CACHE_HOME=/var/lib/xiryn/deploy/cache`, `XDG_CONFIG_HOME=/var/lib/xiryn/deploy/config`, and `NEXT_TELEMETRY_DISABLED=1`. The install script creates those directories owned by `xiryn`. They are on the unit's `ReadWritePaths`.

`/var/backups/xiryn` stays root and mode 0700. The service user cannot create a backup there. Prepare and the pre-switch backup snapshot the database as `xiryn` into `/var/lib/xiryn/deploy/staging/<stamp>`, then root moves that directory to `/var/backups/xiryn/<stamp>-prepare` or `-switch`, chowns it to root, and sets the directory to mode 700 and the files to mode 600. The shared env and the vault key are copied in that last step, still as root.

## Install it once on the existing server

Do this on the EC2 box, as root, from the current checkout. The copy keeps serving until the last restart. Blue is given up to 90 seconds to answer `/api/health`. If it does not, the script enables and starts `xiryn.service` again, so a reboot still comes up on the old unit.

```bash
cd /opt/xiryn
sudo git fetch origin
sudo git checkout main
sudo git pull --ff-only
sudo bash deploy/migrate-blue-green.sh
```

Then point Caddy at the snippet. Keep your existing password hash: copy it into `deploy/Caddyfile.bluegreen` in both `basic_auth` blocks, set the hostname, and replace the site file.

```bash
sudo cp /etc/caddy/Caddyfile /var/backups/xiryn/Caddyfile.pre-bluegreen
sudo cp /opt/xiryn-blue/deploy/Caddyfile.bluegreen /etc/caddy/Caddyfile
# edit the hostname and both password hashes
sudo systemctl reload caddy
```

Open TCP 8443 from your IP if you want to browse the inactive colour before a switch. Until then it is only on the instance. The security group already allows 443 for the live site.

The script is safe to run again. Once `/etc/xiryn/active` exists and `xiryn-blue.service` is installed, it makes sure the green directories, the pin mirror, and the cache and staging directories exist. It installs the current colour units, `/etc/xiryn/blue.env`, `/etc/xiryn/green.env`, and `xiryn-deploy.service`, strips the four per-colour variables from `shared.env` if they are present, reloads systemd, and exits. It does not restart the colour that is serving. After a re-run, restart that colour so it reads the new files:

```bash
sudo systemctl restart xiryn-blue.service
```

Use `xiryn-green.service` when `/etc/xiryn/active` says `green`.

What you still do by hand, because the script will not guess a customised Caddyfile or a security group:

1. Put the basic-auth hash into `deploy/Caddyfile.bluegreen` and reload Caddy, as above.
2. Allow TCP 8443 from your IP if you want the standby page on the public hostname.
3. Leave `/opt/xiryn` in place until you have switched to a new colour once. Then you can remove that old tree. Do not delete `/var/backups/xiryn`, `/etc/xiryn`, or `/var/lib/xiryn-pin.git`.

The script copies the vault key from `/var/lib/xiryn/.xiryn`, the install's `.xiryn`, or the `xiryn` user's home (`~xiryn/.xiryn`, which is where this server keeps `vault-*.key`). It does not print the key. If the database has vault entries and none of those directories has a key, the script stops before it restarts anything.

## What the buttons do

Settings → **Update version** on a wide browser (the item sits in the settings list between Remote access and System). On a phone, or in the installed app, open the **Settings** tab — it shows a dot when a newer commit is on the branch — and tap **Update version** at the top of that screen. The row carries a **New** badge in the same case. Switch and roll back open an approval card on that screen, with full-width Approve and Decline buttons.

**Update** builds the colour that is not serving: fetch the pinned commit, `npm ci`, `npm run build`, copy a snapshot of the live database, migrate that copy, start the unit, and run the health check. Progress is streamed on the same screen. The live process keeps taking requests.

**Switch** asks you to approve that exact commit. After you approve, the helper marks the live colour read-only, takes a final database snapshot, migrates it, reloads Caddy, and checks health. The previous colour stays up. If the health check fails, Caddy is put back and the phase is `rolled_back`.

**Roll back** is the same approval. It points Caddy at the previous colour. If that health check fails, Caddy stays on the colour that was serving.

An agent can call `request_self_update`. The first call is only an approval card, in the thread and on Telegram. Nothing is queued until you approve and the tool is called again with the same action. The helper checks that approval in the live database before it will switch or roll back, then marks it used. A used approval is refused even if it is still inside the 20-minute window, so the same card cannot switch twice.

Every prepare, switch, and rollback writes a line under `/var/lib/xiryn/deploy/audit/` at mode 600. Backups of the database, the shared env, and the vault key go to `/var/backups/xiryn/<timestamp>-prepare` or `-switch`. That directory is root mode 700 and the files inside it are root mode 600. Logs are redacted before they are shown.

## Migrations

Drizzle only runs a journal entry whose `when` is greater than the newest row already in `__drizzle_migrations`. This install applied `0008` at `1792789000000`. `0009` and anything after it must use a later `when`, and the values have to keep increasing. A build that leaves the applied count behind the journal is not marked ready, and Switch will not move Caddy.

## If a switch goes wrong

The old colour is still running. Roll back from the same screen, or on the box:

```bash
# The snippet the helper writes names the upstreams. Put the previous
# colour's port back, then:
sudo systemctl reload caddy
curl -fsS -H 'Host: 127.0.0.1' http://127.0.0.1:6796/api/health
```

The ports above are blue's. Green's app port is 6896. `/etc/xiryn/active` is a label for people; Caddy follows `/etc/caddy/xiryn-upstreams.caddy`.
