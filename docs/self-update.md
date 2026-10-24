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

The vault key (`/etc/xiryn/vault`) and the environment file (`/etc/xiryn/shared.env`, mode 640, group `xiryn`) are shared and not writable by the service. Each colour has its own SQLite file. Caddy sends the public hostname to the active colour. The inactive colour is on port 8443 with the same basic auth (`deploy/Caddyfile.bluegreen`).

`/etc/xiryn-deploy.conf` names the branch (yours is `BRANCH=main`). The helper fetches that one branch through the bare mirror `/var/lib/xiryn-pin.git` and will only build the commit that branch points at. A tag, a short name, or another branch is refused.

## Install it once on the existing server

Do this on the EC2 box, as root, from the current checkout. The copy keeps serving until the last restart. If blue does not answer `/api/health`, the script starts `xiryn.service` again.

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

The script is safe to run again. Once `/etc/xiryn/active` says `blue` and `xiryn-blue.service` is installed, it only makes sure the green directories exist and exits.

What you still do by hand, because the script will not guess a customised Caddyfile or a security group:

1. Put the basic-auth hash into `deploy/Caddyfile.bluegreen` and reload Caddy, as above.
2. Allow TCP 8443 from your IP if you want the standby page on the public hostname.
3. Leave `/opt/xiryn` in place until you have switched to a new colour once. Then you can remove that old tree. Do not delete `/var/backups/xiryn`, `/etc/xiryn`, or `/var/lib/xiryn-pin.git`.

## What the buttons do

Settings → **Update version** on a wide browser (the item sits in the settings list between Remote access and System). On a phone, or in the installed app, open the **Settings** tab — it shows a dot when a newer commit is on the branch — and tap **Update version** at the top of that screen. The row carries a **New** badge in the same case. Switch and roll back open an approval card on that screen, with full-width Approve and Decline buttons.

**Update** builds the colour that is not serving: fetch the pinned commit, `npm ci`, `npm run build`, copy a snapshot of the live database, migrate that copy, start the unit, and run the health check. Progress is streamed on the same screen. The live process keeps taking requests.

**Switch** asks you to approve that exact commit. After you approve, the helper marks the live colour read-only, takes a final database snapshot, migrates it, reloads Caddy, and checks health. The previous colour stays up. If the health check fails, Caddy is put back and the phase is `rolled_back`.

**Roll back** is the same approval. It points Caddy at the previous colour. If that health check fails, Caddy stays on the colour that was serving.

An agent can call `request_self_update`. The first call is only an approval card, in the thread and on Telegram. Nothing is queued until you approve and the tool is called again with the same action. The helper checks that approval in the live database before it will switch or roll back.

Every prepare, switch, and rollback writes a line under `/var/lib/xiryn/deploy/audit/` at mode 600. Backups of the database, the shared env, and the vault key go to `/var/backups/xiryn/<timestamp>/` at mode 600. Logs are redacted before they are shown.

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
