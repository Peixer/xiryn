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

systemd applies every `EnvironmentFile=` after `Environment=`, and a later file replaces the same key in an earlier file. The installer copies the old `/opt/xiryn/.env` into `shared.env`, and that file sets `XIRYN_DATA_DIR=/opt/xiryn/data`. Both colours would then open the same database, on a path the colour sandbox does not make writable. The installer removes `XIRYN_DATA_DIR`, `XIRYN_PORT`, `XIRYN_DESKTOP_PROXY_PORT`, and `XIRYN_VAULT_KEY_DIR` from `shared.env`. It leaves `XIRYN_VAULT_ACCOUNT` alone. It writes `/etc/xiryn/blue.env` and `/etc/xiryn/green.env`, and each unit loads `shared.env` first and its own file second. The colour file sets the data directory, both ports, the vault-key directory, `XIRYN_DEPLOY_DIR`, and `XIRYN_COLOUR`. The unit also sets `XIRYN_COLOUR`, so a colour file from an older install still names itself. A process runs Telegram polling, routines, notification delivery, and the workstation janitor only while `state.json` says that colour is active and `/etc/xiryn/maintenance` is absent. The other process stays up for health checks and does not do that work. A single install, with no colour in the environment and a data directory that does not end in `/blue` or `/green`, is unchanged and always runs it. The two processes take a short exclusive claim (`workers.lock` in the deploy directory) so a handover cannot run the work twice.

The vault key file is `vault-<account>.key`. On a single install the account is the first 16 hex digits of the SHA-256 of the database path, so the production key is named after `/opt/xiryn/data/xiryn.db`. Blue and green use different paths. Naming the key from the new path would miss the existing file, and a switch would look for a different name again. The installer hashes that old path once, writes the digest as `XIRYN_VAULT_ACCOUNT` in both colour files, and keeps that value on a later run. A quoted `XIRYN_DATA_DIR` in the old environment file is unquoted before the hash, so the account matches the path Node opened. Both colours then open `vault-<that>.key` in `/etc/xiryn/vault`.

The Update screen reads `/var/lib/xiryn/deploy/state.json` for the running commit. Before it copies anything, the installer reads `HEAD` of `/opt/xiryn` with `git -c safe.directory=<tree>` (the tree is owned by `xiryn`, and a plain `rev-parse` as root stops with dubious ownership). If that commit is missing, the script exits before it creates the colour trees. It then writes `state.json`: phase `active`, colour `blue` (or the colour already recorded in `/etc/xiryn/active` on a re-run), and that `activeSha`. The file is mode 644 and owned by `xiryn` when that user exists. A re-run does not replace a state file that already contains a commit, so a later prepare is left as it is. The same screen reads the tip from the root-owned pin mirror. Git treats that as dubious ownership for the `xiryn` user, which would leave Latest unknown and hide the New badge. Those reads pass `-c safe.directory=<mirror>`.

`/etc/xiryn-deploy.conf` names the branch (yours is `BRANCH=main`). The helper fetches that one branch through the bare mirror `/var/lib/xiryn-pin.git` and will only build the commit that branch points at. A tag, a short name, or another branch is refused. The install script creates that mirror, root-owned and world-readable, when it is missing. The helper does not.

Git, npm, and node that touch a colour tree or its database run as the `xiryn` user. The oneshot is still root, and it drops with `setpriv` (no new privileges, no capabilities) before those commands. The allow-list only accepts that fixed wrapper, so npm install scripts are not root and the checkout, `node_modules`, `.next`, and `xiryn.db` are owned by `xiryn`. Fetching `origin` into the pin mirror, reloading Caddy, and starting the units stay root. Before each checkout the service user fetches that mirror into the colour (`refs/remotes/pin/<branch>`), including when the colour's `origin` is still GitHub from the copied tree. The mirror is root-owned, so the fetch passes `-c safe.directory=<mirror>` and the same option to the `upload-pack` child that actually opens it. A database snapshot also copies subdirectories such as `skills/`. It skips `backups/` and `.env` everywhere. `vault*` and `*.key` are skipped only at the top of the data directory, so a skill named `vault-*` is kept. Symlinks at the top are left behind. Symlinks inside `skills/` are copied as links.

`xiryn-deploy.service` keeps `ProtectHome=read-only`, so npm and Next cannot write `~/.npm` or `~/.cache`. The helper sets `npm_config_cache=/var/lib/xiryn/deploy/npm-cache`, `XDG_CACHE_HOME=/var/lib/xiryn/deploy/cache`, `XDG_CONFIG_HOME=/var/lib/xiryn/deploy/config`, and `NEXT_TELEMETRY_DISABLED=1`. The install script creates those directories owned by `xiryn`. They are on the unit's `ReadWritePaths`.

`/var/backups/xiryn` stays root and mode 0700. The service user cannot create a backup there. Prepare and the pre-switch backup snapshot the database as `xiryn` into `/var/lib/xiryn/deploy/staging/<stamp>`, then root moves that directory to `/var/backups/xiryn/<stamp>-prepare`, `-switch`, or `-rollback`, chowns it to root, and sets the directory to mode 700 and the files to mode 600. The shared env and the vault key are copied in that last step, still as root.

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

The script is safe to run again. Once `/etc/xiryn/active` exists and `xiryn-blue.service` is installed, it makes sure the green directories, the pin mirror, and the cache and staging directories exist. It installs the current colour units, `/etc/xiryn/blue.env`, `/etc/xiryn/green.env`, and `xiryn-deploy.service`, strips the four per-colour variables from `shared.env` if they are present, and keeps the vault account already written into the colour files. If `state.json` has no commit yet, it writes one from the active colour's checkout. It reloads systemd and exits. It does not restart the colour that is serving. After a re-run, restart that colour so it reads the new files:

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

**Switch** asks you to approve that exact commit. After you approve, the helper marks the live colour read-only. That is not only the proxy: the process refuses further database writes, waits for in-flight turns to finish, and the helper holds a write lock on the live database until the snapshot is taken and the previous colour has stopped. It then takes the final database snapshot, migrates it, reloads Caddy, and checks health. It writes the new active colour while the maintenance file is still there, stops the previous colour, then removes the file. The colour that is now serving starts Telegram, routines, and the janitor. The previous process is stopped so a build that does not know this rule cannot keep polling. If the health check fails, Caddy is put back, the previous colour is left running, and the phase is `rolled_back`.

**Roll back** asks you to approve that exact previous commit. The card says that data written since the switch will be discarded, how many timestamped rows that is, and how many removed rows (including vault items) would come back. Those counts are as of when the card was opened. Approve stays off until you confirm that loss. Telegram uses a separate "Discard and roll back" button, and a plain approve is refused. Before Caddy moves, the helper keeps a backup of the database it is about to stop serving. It starts the previous colour if that process is stopped, then points Caddy at it. After the health check, the colour you are leaving is stopped. If the health check fails, Caddy stays on the colour that was serving, and a colour this attempt had to start is stopped again.

An agent can call `request_self_update`. The first call is only an approval card, in the thread and on Telegram. Nothing is queued until you approve and the tool is called again with the same action. The helper checks that approval in the live database before it will switch or roll back, then marks it used. A used approval is refused even if it is still inside the 20-minute window, so the same card cannot switch twice.

Every prepare, switch, and rollback writes a line under `/var/lib/xiryn/deploy/audit/` at mode 600. Backups of the database, the shared env, and the vault key go to `/var/backups/xiryn/<timestamp>-prepare`, `-switch`, or `-rollback`. That directory is root mode 700 and the files inside it are root mode 600. The rollback copy is the database the rollback stops serving, so the next prepare can replace that colour's live file without deleting the only copy of those writes. Logs are redacted before they are shown.

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
