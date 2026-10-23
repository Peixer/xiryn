# Mail, calendar, Drive and MCP

Agents can call tools that live outside their workstation: Gmail, Google Calendar, Google Drive, and any [MCP](https://modelcontextprotocol.io) server you add. Reading runs immediately. Sending mail, saving a draft, replying, creating or changing a calendar event, and creating, renaming, moving, copying, trashing or sharing a Drive file stop the turn and wait. Nothing is sent until you approve that exact call, in the thread or with the Telegram buttons. Approving runs the same arguments again; declining tells the agent to stop. Sharing a Drive file, including a link anyone can open, always waits. Trash moves a file to the trash. There is no permanent delete.

Secrets stay out of git. Google's refresh token is sealed with the same vault key as saved logins (`lib/vault.ts`). MCP tokens belong in the environment, referenced from the config as `${ENV:NAME}`.

## Gmail and Google Calendar

These two are built in. Xiryn talks to Google's APIs itself and finishes OAuth at `https://<your-host>/api/google/oauth/callback`, so it works on a server with no browser of its own. You do the consent click from your own computer.

### 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project, or pick one you already use for this.
2. **APIs & Services → Library**. Enable **Gmail API** and **Google Calendar API**. Enable **Google Drive API** as well when you want Drive. Drive is off until you turn it on, so a Gmail-only setup does not need it.
3. **APIs & Services → OAuth consent screen**.
   - User type: **External** (unless this is a Google Workspace account, in which case Internal is simpler and skips the 7-day limit below).
   - App name: anything, for example `Xiryn`.
   - User support email and developer contact: your own address.
   - Scopes: add
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
     - and, only if Drive is on, the Drive scope from the next section. Read-only Drive uses `https://www.googleapis.com/auth/drive.readonly`. Read-write Drive uses `https://www.googleapis.com/auth/drive`.
   - Test users: add the Google account you want the agents to use.
4. Leave the app in **Testing** if you have not gone through Google's verification. Gmail scopes are restricted. In Testing mode, only test users can connect, and Google expires the refresh token after **7 days** — reconnect from Settings when mail starts failing. A Workspace **Internal** app does not have that 7-day expiry. Publishing an External app to Production for these scopes requires Google's verification; don't do that for a one-person server unless you want to go through it.

### 2. OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Authorized redirect URI, exactly, with your real host and no trailing slash:

   ```
   https://<your-host>/api/google/oauth/callback
   ```

   That host is whatever you open in the browser (the Caddy site in `docs/aws.md`). It must match `XIRYN_URL`.

4. Copy the client id and client secret. They are not a Google password.

### 3. Give them to Xiryn

On the server, in `/opt/xiryn/.env` (or **Settings → Connectors**):

```bash
XIRYN_URL=https://<your-host>
GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=the-secret
```

Restart Xiryn (`sudo systemctl restart xiryn` if you use the unit in `deploy/`).

`XIRYN_URL` has to be the public `https://` origin. The redirect back from Google is a normal visit to your site, so Caddy's basic auth applies: the browser will ask for that password if it does not still have it, then continue. The code in the address bar is exchanged once and not stored.

### 4. Connect

1. Open `https://<your-host>/settings` and go to **Connectors**.
2. Confirm the redirect URI shown there matches the one in Google Cloud.
3. Click **Connect Google**. Sign in as the test user, accept the scopes.
4. You land back in Settings, and the panel says **connected**. The refresh token is sealed in `data/xiryn.db`. It is not written into git.

Gmail and Calendar tools turn on together with that connection. Uncheck either one to hide it. `XIRYN_GMAIL=off` or `XIRYN_CALENDAR=off` does the same.

Agents then have `gmail_search`, `gmail_read`, `gmail_draft`, `gmail_send`, `gmail_reply`, `calendar_list_events`, `calendar_create_event`, `calendar_update_event` and `calendar_delete_event`.

To disconnect, use **Disconnect** in Settings. That revokes the grant at Google and deletes the sealed token. A refresh token left in the environment stays unused until you connect again. Gmail keeps one Google account. There is no account picker, and Drive uses that same account.

## Google Drive

Drive is the same OAuth client and the same sealed refresh token. It stays off until you check **Drive tools**, so connecting Gmail does not ask for a Drive scope. The default is read-only.

1. In the same Cloud project, enable **Google Drive API**.
2. On the OAuth consent screen, add the scope you are about to grant:
   - Read-only: `https://www.googleapis.com/auth/drive.readonly`
   - Read-write: `https://www.googleapis.com/auth/drive`
3. In **Settings → Connectors**, on the Google Drive card, turn **Drive tools** on. Leave **Read-only** checked unless you want changes.
4. Click **Connect Google** or **Reconnect Google**, then **Test connection**. The test calls Drive's `about` endpoint and shows the account email. It does not log the token.

`drive.file` is not used. It can only see files this app created or that you opened with it, so a search of your existing Drive would miss them, and rename, move, copy, trash and share would fail. `drive.readonly` can see and download existing files and cannot change them. That is the read-only scope. Changing a file you already have needs the full `drive` scope, and only the read-write setting asks for it. Both Drive scopes are restricted, like Gmail: in Testing mode the refresh token expires after 7 days unless the app is a Workspace internal app.

Read tools run immediately: `drive_search`, `drive_list_folders`, `drive_get`, `drive_read`, `drive_list_permissions`. Search takes text, a folder and a mime type, and returns one page (at most 20) plus a page token. It does not walk every page by itself. `drive_read` exports a Google Doc to markdown (plain text if markdown is refused), a Sheet to csv, and Slides to plain text. `pdf-text` is that plain-text export, not a parsed PDF. Text is capped. A binary file returns metadata unless the agent passes a workstation path, and then only if it is under 8 MB. Names and contents are wrapped as untrusted data.

These wait for approval, and only exist after you uncheck Read-only and reconnect so the full scope is on the token: `drive_create_folder`, `drive_create_file`, `drive_create_doc`, `drive_update_file`, `drive_copy_file`, `drive_trash`. The card shows the action, the file name, and the destination folder. A hostile name cannot draw a second line on the card. `drive_create_doc` imports text into a Google Doc, or csv into a Google Sheet. `drive_trash` sets `trashed: true`. Xiryn does not call Drive's permanent delete.

`drive_share` always waits, even if some other policy would skip a write. The card says who gains access. A public link is marked `PUBLIC`. The grant sets `allowFileDiscovery` to false and does not ask Google to email anyone. Listing permissions does not wait.

File names and file contents from Drive are untrusted data, the same way a mail body is. Disconnect Drive hides the tools and leaves Gmail connected. Disconnect Google on the first card deletes the refresh token for all three.

`XIRYN_DRIVE` stays `off` until you set it to `on`. `XIRYN_DRIVE_ACCESS` stays `readonly` until you set it to `readwrite`. Reconnect sends the whole scope list again: Google is not asked to keep scopes from the previous consent, so Gmail and Calendar stay on that request too. Disconnect revokes the Google grant and clears the scopes stored for this server.

## Other MCP servers

Anything else is a server you list in `data/mcp.json` (next to the database, mode `600`, gitignored because `data/` is). **Settings → Connectors** edits that file. An example is `deploy/mcp.example.json`.

```json
{
  "servers": [
    {
      "id": "docs",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${ENV:DOCS_MCP_TOKEN}" },
      "approval": "writes"
    },
    {
      "id": "notes",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "NOTES_TOKEN": "${ENV:NOTES_TOKEN}" }
    }
  ]
}
```

- `http` is streamable HTTP. `sse` is the older HTTP transport. `stdio` runs `command` plus `args` on the **Xiryn host**, as the user the service runs as — not inside an agent's container, and not on your laptop. Only the servers in this file exist. An agent cannot add one or change the command.
- `command` is the executable. Arguments go in `args`, not in a shell string. By default the program must be `npx`, `uvx`, `node`, `python3`, `python`, `docker`, or `bunx`. A full path is accepted only when its file name is one of those and it sits in a standard install location (`/usr/bin`, `/usr/local/bin`, Homebrew, the Windows Node.js directory, and the like). `/tmp`, a relative path, and a path that resolves to a shell are refused. `sh`, `bash`, and `zsh` are refused. Add other program names, not paths, under **Settings → Connectors** (`mcp.allowedCommands`) or with `XIRYN_MCP_ALLOWED_COMMANDS`. If you add a shell, its arguments still cannot contain shell metacharacters.
- Saving a new stdio server, or changing its `command` or `args`, asks you to confirm that exact command and those arguments. The server issues a one-time confirmation for them, so a request that skips the dialog is refused. The process runs on the Xiryn host, as the user the service runs as. Changing only a benign `env` entry, `headers`, `approval`, or `enabled` does not ask again. `env` cannot set `PATH`, `HOME`, `NODE_OPTIONS`, loader variables (`LD_*`, `DYLD_*`), or a package index (`npm_config_*`, `UV_INDEX_URL`, `UV_PYTHON`, and similar). `${ENV:NAME}` in `command` is not expanded; `$` in the command is refused.
- `${ENV:NAME}` is replaced from the environment when the server starts. Prefer that to pasting a token into `mcp.json`.
- `approval` is `writes` (the default), `all`, or `none`. A tool also waits when its MCP description says it is destructive, and it skips the wait when the server marks it read-only. `approve` and `readOnly` are lists of tool names that override that.

Tools show up as `mcp_<server-id>_<tool-name>`. A server that fails to start is skipped for that turn and the agent is told it is unavailable; the rest of the turn still runs.

stdio processes stay running until you save a new config or restart Xiryn.
