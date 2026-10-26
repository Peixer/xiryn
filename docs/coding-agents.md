# Coding agents

Coding agents (category **Coding** in Settings → Agents) get a dedicated toolset: the Codex CLI and a shared Git credential volume so they can push commits without exposing a token to the model.

## Coding sessions

`spawn_work_session` starts up to five Codex or Claude Code processes in the agent's workstation, each on its own git branch. The person starts those sessions from a conversation they are in, in the app or on Telegram. A scheduled routine does not receive the tool, and neither does the turn that runs when a batch finishes. List, status, and cancel stay available on those turns.

### Why the CLIs skip their own permission prompts

Codex and Claude Code wait for a person to approve each file edit and shell command in a terminal. A coding session has no terminal: it is a background process, so Xiryn starts them with `--dangerously-bypass-approvals-and-sandbox` (Codex) and `--dangerously-skip-permissions` (Claude Code). That is what lets the brief finish.

The risk is the same flag. Until the process exits, the CLI can edit the repository, use the network, and use the workstation git credential, including push, with no further prompt inside the CLI. The owner's consent is the conversation they started. The session still does not push or open a pull request on its own; the prompt tells the agent to do that only when the person asks. The credential file itself is covered in the section below.

### Which repositories a session can use

`repoPath` has to be a visible directory inside the workstation home, under `/home/xiryn`. The default is `/home/xiryn/xiryn`. The home directory itself is refused because it holds `.coding-creds` and the `.git-credentials` symlink. Hidden directories (`.coding-creds`, `.ssh`, `.git`, and anything else starting with a dot) are refused. `..`, a path outside `/home/xiryn`, and a symlink whose target leaves that home are refused. The check runs on the path the model sent and again on the path the workstation resolves, so a link to the credential volume or to `/etc` does not become the working tree.

## Git credentials for coding agents

### How it works

| Layer | Detail |
|-------|--------|
| Docker volume | `xiryn-coding-creds` — created automatically on first `xiryn-git-token set` |
| Mount path | `/home/xiryn/.coding-creds` inside every coding-agent workstation |
| File | `.git-credentials` — standard Git credential store format |
| Ownership | uid 1000 (the `xiryn` user inside the workstation image), mode 0600 |
| Access | Oldest coding agent: read-write. All others: read-only. |

At workstation startup, `scripts/setup-coding-tools.sh` symlinks `~/.git-credentials` → `/home/xiryn/.coding-creds/.git-credentials` and sets `credential.helper store`.

### Setting up credentials

Use the `xiryn-git-token` command (installed to `/usr/local/sbin` by `deploy/migrate-blue-green.sh`).

```bash
# Interactive — paste username then token
sudo xiryn-git-token set

# Piped — useful in automation
printf '%s\n%s\n' 'your-github-username' 'github_pat_...' | sudo xiryn-git-token set

# Full-URL format
echo 'https://your-github-username:github_pat_...@github.com' | sudo xiryn-git-token set
```

The token is read from **stdin only** — it never appears in `argv`, shell history, or process listings.

### Viewing the stored credential

```bash
sudo xiryn-git-token show
# host=github.com  user=your-github-username  token=gith***ab12
```

The token is always masked.

### Removing credentials

```bash
sudo xiryn-git-token clear
```

### Recommended GitHub PAT scopes

Create a **fine-grained** PAT at <https://github.com/settings/tokens?type=beta> scoped to only the repositories the agents need.

| Permission | Level | Why |
|------------|-------|-----|
| Contents | Read and write | Clone, push, pull |
| Metadata | Read | Required for all tokens |
| Pull requests | Read and write | Open and update PRs |

A fine-grained PAT limited to specific repos is strongly preferred over a classic PAT.

### Rotation

1. Generate a new PAT in GitHub.
2. Run `sudo xiryn-git-token set` with the new token.
3. Running agents pick up the change immediately (the symlink points live into the volume).
4. Revoke the old token in GitHub.

### Verifying from inside a workstation

Open a terminal in a coding agent and run:

```bash
# Check the symlink is in place
ls -la ~/.git-credentials

# Test the credential against GitHub
git ls-remote https://github.com/<owner>/<repo>
```

## Troubleshooting

**`fatal: could not read Username for 'https://github.com'`**
Run `sudo xiryn-git-token show` on the host. If the file is missing, run `sudo xiryn-git-token set`. If it exists, the agent may have started before the credential was written — restart the agent.

**Agent can clone but not push**
The PAT is missing write scope, or this agent is not the credential owner (only the oldest coding agent gets read-write access). Check Settings → Agents → Coding to see which agent owns the volume.

**`WARNING: /home/xiryn/.git-credentials exists on the host`**
This file is not used by agents. Move it into the volume:
```bash
sudo cat /home/xiryn/.git-credentials | sudo xiryn-git-token set
sudo rm /home/xiryn/.git-credentials   # only after verifying show works
```
