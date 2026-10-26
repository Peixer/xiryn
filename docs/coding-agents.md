# Coding agents

Coding agents (category **Coding** in Settings → Agents) get a dedicated toolset: the Codex CLI, Claude Code, and a Git credential so they can push commits without the token being placed in the prompt.

## Git credentials for coding agents

Each coding agent mounts one credential volume, at `/home/xiryn/.coding-creds`.

| Agent | Volume | Mount |
| --- | --- | --- |
| Has a token of its own | `xiryn-git-creds-<agent-id>` | read-write, this agent only |
| Does not, yet | `xiryn-coding-creds` (the shared fallback) | read-only |

The file is `.git-credentials`, the standard Git credential store, mode 0600, owner uid 1000 (the `xiryn` user in the workstation image). No agent is picked by age, and a name does not grant access. An agent with its own volume does not mount the shared volume and does not mount any other agent's volume.

At workstation startup, and again at the start of a later coding turn, `scripts/setup-coding-tools.sh` symlinks `~/.git-credentials` to that file and points Git at a helper. The helper reads the file live. It writes a new credential back only when the directory is writable, which is the per-agent volume. On the read-only shared fallback the save is ignored, so Git still clones and pushes with the token that is already there.

The shared volume is how an existing install keeps working. The workstation whose hostname is `gr8-codegen` uses it today. Leave that file in place until you have set a token for that agent and `xiryn-git-token show <agent-id>` succeeds.

### Setting a token

`xiryn-git-token` is installed to `/usr/local/sbin` by `deploy/migrate-blue-green.sh`. The token is read from **stdin only**. It is not an argument, so it does not land in shell history or in the process list.

```bash
# One agent. The id is the xiryn.agent label, not the hostname.
printf '%s\n%s\n' 'your-github-username' 'github_pat_...' | sudo xiryn-git-token set AGENT_ID

# Same token as a single URL line
echo 'https://your-github-username:github_pat_...@github.com' | sudo xiryn-git-token set AGENT_ID

# Shared fallback, used by every coding agent that does not have its own yet
printf '%s\n%s\n' 'your-github-username' 'github_pat_...' | sudo xiryn-git-token set
```

The first time you set an agent's token, Codex's `auth.json` and `.gitconfig` are copied from the shared volume when they are present. The shared PAT is not copied. The agent's workstation container is removed so the next run creates it with only that agent's volume. The home folder (`xiryn-home-<agent-id>`) is kept.

### Seeing what is stored

```bash
sudo xiryn-git-token show AGENT_ID
# agent=AGENT_ID  host=github.com  user=your-github-username  token=gith***ab12

sudo xiryn-git-token show
# shared  host=github.com  user=your-github-username  token=gith***ab12

sudo xiryn-git-token list
```

The token is always masked: the first four characters, then `***`, then the last four.

### Removing a token

```bash
sudo xiryn-git-token clear AGENT_ID   # that agent falls back to the shared volume
sudo xiryn-git-token clear             # deletes the shared file; does not delete per-agent tokens
```

Clear the shared file only after every coding agent that still pushes has its own token. On this host that includes `gr8-codegen`.

Find the agent id from the workstation hostname:

```bash
docker ps -aq --filter label=xiryn.workstation=1 \
  | xargs -r docker inspect --format '{{.Config.Hostname}} {{index .Config.Labels "xiryn.agent"}} {{.Name}}'
```

The first column is the hostname (`gr8-codegen`). The second is the id you pass to `xiryn-git-token`.

### Minimum PAT scopes

Create a **fine-grained** personal access token at <https://github.com/settings/tokens?type=beta>, one token per coding agent.

- **Resource owner:** you, or the organization that owns the repos.
- **Repository access:** Only select repositories. Pick the repos that agent works on. Do not choose All repositories.
- **Permissions,** and nothing else:
  - **Metadata:** Read-only. GitHub requires this.
  - **Contents:** Read-only when the agent only clones. Read and write when it pushes.
  - **Pull requests:** Read and write only when that agent opens or updates pull requests.

Do not grant Administration, Secrets, Actions, Workflows, or account permissions for this. A classic PAT (`ghp_` or a 40-character hex token) still works, and it is broader than this. Prefer the fine-grained token.

### Rotation

1. Generate a new fine-grained PAT for that agent.
2. Run `sudo xiryn-git-token set AGENT_ID` with the new token.
3. Revoke the old token in GitHub.
4. The next time the agent runs, its workstation mounts the new file. A shared-token change is visible immediately to agents still on the fallback, because they read the live file.

### GitHub App tokens

A GitHub App installation token (`ghs_...`) is accepted by `xiryn-git-token` and stored in the same per-agent file. Those tokens are short-lived and can be limited to one repository. Nothing in Xiryn mints or refreshes them. You can drop one in with `set` the same way as a PAT. A later change can replace the file on a timer without changing the mount: the volume stays per agent either way.

### Verifying from inside a workstation

Open a terminal in that coding agent:

```bash
ls -la ~/.git-credentials
git ls-remote https://github.com/<owner>/<repo>
```

The symlink target is `/home/xiryn/.coding-creds/.git-credentials`. On an agent with its own token, that directory is its volume and does not contain another agent's token.

## Troubleshooting

**`fatal: could not read Username for 'https://github.com'`**

On the host, `sudo xiryn-git-token show AGENT_ID` (or `show` with no id for the shared fallback). If it says none, set a token. If it is set, the workstation may have been created before the file existed. Start a coding turn, or remove the container with `docker rm -f xiryn-ws-AGENT_ID` (the home volume is a different name and is kept) and let the next turn create it again.

**Push works from one coding agent and not another**

They no longer share a writable token. Set a token for the agent that fails, with Contents set to read and write on that repo.

**`WARNING: /home/xiryn/.git-credentials exists on the host`**

That file is not what agents read. Move it into the shared fallback, then give each agent its own:

```bash
sudo cat /home/xiryn/.git-credentials | sudo xiryn-git-token set
sudo xiryn-git-token set AGENT_ID
sudo rm /home/xiryn/.git-credentials   # only after verifying show works
```

**Deleting an agent**

Deleting the agent removes `xiryn-git-creds-<agent-id>`. Resetting the workstation does not. The shared volume is not removed when an agent is deleted.
