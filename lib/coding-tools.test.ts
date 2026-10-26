import assert from "node:assert/strict"
import { test } from "node:test"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  GIT_CREDS_MOUNT,
  SHARED_GIT_VOLUME,
  codingAccess,
  codingCredentialMode,
  codingVolumeArgs,
  gitCredentialVolume,
} from "./coding-tools"

const repo = path.join(import.meta.dirname, "..")

function mountedVolume(args: string[]) {
  const index = args.indexOf("--volume")
  assert.notEqual(index, -1)
  const spec = args[index + 1] ?? ""
  const [name, target, mode] = spec.split(":")
  return { name, target, mode, spec }
}

test("each coding agent mounts only its own credential, with a shared read-only fallback", () => {
  const general = { id: "general", category: "general" as const }
  const agentA = { id: "agentA", category: "coding" as const }
  const agentB = { id: "agentB", category: "coding" as const }
  const files: Record<string, string> = {
    [SHARED_GIT_VOLUME]: "shared-token",
    [gitCredentialVolume("agentA")]: "token-a",
    [gitCredentialVolume("agentB")]: "token-b",
  }
  const see = (args: string[]) => {
    const mount = mountedVolume(args)
    return { ...mount, secret: files[mount.name] }
  }

  assert.deepEqual(codingVolumeArgs(general, true), [])
  assert.equal(codingAccess(general, true), "off")
  assert.equal(codingCredentialMode({ id: "../x", category: "coding" }, true), "shared")
  assert.throws(() => gitCredentialVolume("../x"))

  const ownA = see(codingVolumeArgs(agentA, true))
  const ownB = see(codingVolumeArgs(agentB, true))
  assert.equal(ownA.secret, "token-a")
  assert.equal(ownB.secret, "token-b")
  assert.equal(ownA.mode, "rw")
  assert.equal(ownB.mode, "rw")
  assert.equal(ownA.target, GIT_CREDS_MOUNT)
  assert.equal(ownA.spec.includes("agentB"), false)
  assert.equal(ownA.spec.includes(SHARED_GIT_VOLUME), false)
  assert.equal(ownB.spec.includes("agentA"), false)
  assert.equal(ownB.spec.includes(SHARED_GIT_VOLUME), false)
  assert.notEqual(ownA.secret, ownB.secret)

  const sharedA = see(codingVolumeArgs(agentA, false))
  const sharedB = see(codingVolumeArgs(agentB, false))
  assert.equal(sharedA.secret, "shared-token")
  assert.equal(sharedB.secret, "shared-token")
  assert.equal(sharedA.mode, "ro")
  assert.equal(sharedB.mode, "ro")
  assert.equal(sharedA.spec, sharedB.spec)
  assert.equal(sharedA.spec.includes(":rw"), false)
  assert.deepEqual(codingVolumeArgs(agentA, false), [
    "--volume",
    `${SHARED_GIT_VOLUME}:${GIT_CREDS_MOUNT}:ro`,
    "--env",
    "XIRYN_CODING_TOOLS=1",
    "--env",
    "XIRYN_GIT_CREDS_MODE=shared",
  ])
  assert.equal(codingAccess(agentA, true), "own")
  assert.equal(codingAccess(agentB, false), "shared")
})

test("coding setup is idempotent and retries an incomplete npm install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-coding-"))
  try {
    const bin = path.join(root, "bin")
    fs.mkdirSync(bin)
    fs.mkdirSync(path.join(root, "codex-cli")) // interrupted previous install
    fs.writeFileSync(
      path.join(bin, "npm"),
      '#!/bin/bash\nset -e\necho install >> "$HOME/installs"\nif [[ "$*" == *anthropic* ]]; then mkdir -p "$HOME/.local/bin"; printf "#!/bin/sh\\n" > "$HOME/.local/bin/claude"; chmod +x "$HOME/.local/bin/claude"; exit 0; fi\nmkdir -p "$HOME/codex-cli/node_modules/.bin"\nprintf "#!/bin/sh\\n" > "$HOME/codex-cli/node_modules/.bin/codex"\nchmod +x "$HOME/codex-cli/node_modules/.bin/codex"\n',
      { mode: 0o755 }
    )
    const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` }
    for (let i = 0; i < 2; i++)
      execFileSync("bash", ["scripts/setup-coding-tools.sh"], { env })
    assert.equal(
      fs.readFileSync(path.join(root, "installs"), "utf8"),
      "install\ninstall\n"
    )
    assert.ok(fs.lstatSync(path.join(root, ".local/bin/codex")).isSymbolicLink())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("category migration preserves existing coding opt-in and legacy column", async () => {
  const { default: Database } = await import("better-sqlite3")
  const sqlite = new Database(":memory:")
  try {
    sqlite.exec("CREATE TABLE agents (id text, coding_tools integer NOT NULL DEFAULT 0)")
    sqlite.exec("INSERT INTO agents VALUES ('coding', 1), ('general', 0)")
    sqlite.exec(fs.readFileSync("db/migrations/0011_agent_category.sql", "utf8"))
    assert.deepEqual(sqlite.prepare("SELECT * FROM agents ORDER BY id").all(), [
      { id: "coding", coding_tools: 1, category: "coding" },
      { id: "general", coding_tools: 0, category: "general" },
    ])
  } finally {
    sqlite.close()
  }
})

// Helper used by the git-credentials tests below
function makeCredsEnv(
  root: string,
  creds: string
): { env: NodeJS.ProcessEnv; script: string } {
  const bin = path.join(root, "bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(creds, { recursive: true })
  // Minimal fake npm that satisfies the codex install check
  fs.writeFileSync(
    path.join(bin, "npm"),
    '#!/bin/bash\nmkdir -p "$HOME/codex-cli/node_modules/.bin"\nprintf "#!/bin/sh\\n" > "$HOME/codex-cli/node_modules/.bin/codex"\nchmod +x "$HOME/codex-cli/node_modules/.bin/codex"\n',
    { mode: 0o755 }
  )
  // Patch the CREDS path in the script so it points to our temp dir
  const src = fs
    .readFileSync("scripts/setup-coding-tools.sh", "utf8")
    .replace("/home/xiryn/.coding-creds", creds)
  const script = path.join(root, "setup.sh")
  fs.writeFileSync(script, src, { mode: 0o755 })
  const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH ?? ""}` }
  return { env, script }
}

test("setup-coding-tools: links credentials when .git-credentials is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-missing-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(
      out.includes("linked from volume"),
      `expected 'linked from volume' in: ${out}`
    )
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
    assert.equal(
      fs.readlinkSync(path.join(root, ".git-credentials")),
      path.join(creds, ".git-credentials")
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("setup-coding-tools: skips when .git-credentials is already a symlink (idempotent)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-linked-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    fs.symlinkSync(
      path.join(creds, ".git-credentials"),
      path.join(root, ".git-credentials")
    )
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(out.includes("already linked"), `expected 'already linked' in: ${out}`)
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("setup-coding-tools: replaces empty .git-credentials file with symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-empty-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    fs.writeFileSync(path.join(root, ".git-credentials"), "") // empty regular file
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(
      out.includes("replaced empty file"),
      `expected 'replaced empty file' in: ${out}`
    )
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("setup-coding-tools: backs up non-empty stale file then symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-stale-"))
  const creds = path.join(root, "creds")
  try {
    const { env, script } = makeCredsEnv(root, creds)
    fs.writeFileSync(path.join(creds, ".git-credentials"), "https://u:t@github.com\n")
    const stale = "https://old:oldtoken@github.com\n"
    fs.writeFileSync(path.join(root, ".git-credentials"), stale) // non-empty stale
    const out = execFileSync("bash", [script], { env, encoding: "utf8" })
    assert.ok(
      out.includes("backed up stale file"),
      `expected 'backed up stale file' in: ${out}`
    )
    assert.ok(fs.lstatSync(path.join(root, ".git-credentials")).isSymbolicLink())
    assert.ok(fs.existsSync(path.join(root, ".git-credentials.bak")), "backup must exist")
    assert.equal(fs.readFileSync(path.join(root, ".git-credentials.bak"), "utf8"), stale)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const TOKEN_A = "github_pat_agentAsecretvalue000111"
const TOKEN_B = "github_pat_agentBsecretvalue000222"
const TOKEN_SHARED = "github_pat_sharedsecretvalue00333"

function writeStore(dir: string, user: string, token: string) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, ".git-credentials"),
    `https://${user}:${token}@github.com\n`,
    {
      mode: 0o600,
    }
  )
}

function prepareCodingHome(home: string) {
  const bin = path.join(home, "bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(
    path.join(bin, "npm"),
    '#!/bin/bash\nmkdir -p "$HOME/codex-cli/node_modules/.bin"\nprintf "#!/bin/sh\\n" > "$HOME/codex-cli/node_modules/.bin/codex"\nchmod +x "$HOME/codex-cli/node_modules/.bin/codex"\n',
    { mode: 0o755 }
  )
  return bin
}

function credentialGet(home: string) {
  const helper = path.join(home, ".local/bin/xiryn-git-credential")
  const result = spawnSync(helper, ["get"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  })
  assert.equal(result.status, 0, result.stderr)
  return `${result.stdout}\n${result.stderr}`
}

test("setup links only the credential mounted for that agent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-creds-iso-"))
  const homeA = path.join(root, "a")
  const homeB = path.join(root, "b")
  const credsA = path.join(root, "creds-a")
  const credsB = path.join(root, "creds-b")
  const credsShared = path.join(root, "creds-shared")
  try {
    writeStore(credsA, "agent-a", TOKEN_A)
    writeStore(credsB, "agent-b", TOKEN_B)
    writeStore(credsShared, "shared", TOKEN_SHARED)
    for (const [home, creds] of [
      [homeA, credsA],
      [homeB, credsB],
    ] as const) {
      const bin = prepareCodingHome(home)
      execFileSync("bash", ["scripts/setup-coding-tools.sh"], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          XIRYN_GIT_CREDS: creds,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
        },
      })
    }
    const seenA = credentialGet(homeA)
    const seenB = credentialGet(homeB)
    assert.equal(seenA.includes(TOKEN_A), true)
    assert.equal(seenA.includes(TOKEN_B), false)
    assert.equal(seenA.includes(TOKEN_SHARED), false)
    assert.equal(seenB.includes(TOKEN_B), true)
    assert.equal(seenB.includes(TOKEN_A), false)
    assert.equal(seenB.includes(TOKEN_SHARED), false)

    const before = fs.readFileSync(path.join(credsA, ".git-credentials"), "utf8")
    fs.chmodSync(credsA, 0o555)
    fs.chmodSync(path.join(credsA, ".git-credentials"), 0o444)
    const helper = path.join(homeA, ".local/bin/xiryn-git-credential")
    const stored = spawnSync(helper, ["store"], {
      input: `protocol=https\nhost=github.com\nusername=agent-a\npassword=${TOKEN_B}\n\n`,
      encoding: "utf8",
      env: { ...process.env, HOME: homeA },
    })
    assert.equal(stored.status, 0, stored.stderr)
    assert.equal(stored.stderr.includes(TOKEN_B), false)
    assert.equal(fs.readFileSync(path.join(credsA, ".git-credentials"), "utf8"), before)
  } finally {
    if (fs.existsSync(credsA)) fs.chmodSync(credsA, 0o755)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function writeFakeDocker(root: string) {
  const bin = path.join(root, "bin")
  const volumes = path.join(root, "volumes")
  const log = path.join(root, "docker.log")
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(volumes, { recursive: true })
  fs.writeFileSync(log, "")
  fs.writeFileSync(
    path.join(bin, "docker"),
    `#!/bin/bash
set -euo pipefail
root=${JSON.stringify(volumes)}
log=${JSON.stringify(log)}
printf '%s\\n' "$*" >> "$log"
cmd="\${1:-}"
shift || true
if [[ "$cmd" == inspect || "$cmd" == rm ]]; then
  exit 1
fi
[[ "$cmd" == volume ]] || { echo "unexpected docker $cmd" >&2; exit 1; }
sub="\${1:-}"
shift || true
case "$sub" in
  inspect)
    format=''
    name=''
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) format=$2; shift 2 ;;
        *) name=$1; shift ;;
      esac
    done
    dir="$root/$name"
    if [[ ! -d "$dir" ]]; then
      echo "Error: No such volume: $name" >&2
      exit 1
    fi
    if [[ -n "$format" ]]; then
      printf '%s\\n' "$dir"
    fi
    ;;
  create)
    name=''
    labels=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --label) labels+=("$2"); shift 2 ;;
        *) name=$1; shift ;;
      esac
    done
    mkdir -p "$root/$name"
    if [[ \${#labels[@]} -gt 0 ]]; then
      printf '%s\\n' "\${labels[@]}" > "$root/$name.labels"
    else
      : > "$root/$name.labels"
    fi
    ;;
  rm)
    name=''
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --force|-f) shift ;;
        *) name=$1; shift ;;
      esac
    done
    rm -rf "$root/$name" "$root/$name.labels"
    ;;
  ls)
    filter=''
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --filter) filter=$2; shift 2 ;;
        --format) shift 2 ;;
        *) shift ;;
      esac
    done
    [[ "$filter" == label=xiryn.kind=git-credential ]] || exit 0
    shopt -s nullglob
    for dir in "$root"/*; do
      [[ -d "$dir" ]] || continue
      labels="$dir.labels"
      [[ -f "$labels" ]] || continue
      if grep -qx 'xiryn.kind=git-credential' "$labels"; then
        basename "$dir"
      fi
    done
    ;;
  *)
    echo "unexpected volume $sub" >&2
    exit 1
    ;;
esac
`,
    { mode: 0o755 }
  )
  return { bin, volumes, log }
}

function runGitToken(bin: string, volumes: string, args: string[], input?: string) {
  return spawnSync("bash", [path.join(repo, "deploy/xiryn-git-token"), ...args], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      DOCKER_FAKE_ROOT: volumes,
    },
  })
}

function volumeTree(dir: string) {
  if (!fs.existsSync(dir)) return ""
  const parts: string[] = []
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else parts.push(fs.readFileSync(full, "utf8"))
    }
  }
  walk(dir)
  return parts.join("\n")
}

test("xiryn-git-token keeps agent credentials in separate volumes and masks them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-git-token-"))
  try {
    const { bin, volumes, log } = writeFakeDocker(root)
    const shared = runGitToken(bin, volumes, ["set"], `shared-user\n${TOKEN_SHARED}\n`)
    assert.equal(shared.status, 0, `${shared.stdout}\n${shared.stderr}`)
    assert.equal(shared.stdout.includes(TOKEN_SHARED), false)
    assert.equal(shared.stderr.includes(TOKEN_SHARED), false)
    fs.mkdirSync(path.join(volumes, SHARED_GIT_VOLUME, ".codex"), { recursive: true })
    fs.writeFileSync(
      path.join(volumes, SHARED_GIT_VOLUME, ".codex", "auth.json"),
      '{"marker":"codex-from-shared"}\n'
    )

    const setA = runGitToken(bin, volumes, ["set", "agentA"], `agent-a\n${TOKEN_A}\n`)
    assert.equal(setA.status, 0, `${setA.stdout}\n${setA.stderr}`)
    const setB = runGitToken(bin, volumes, ["set", "agentB"], `agent-b\n${TOKEN_B}\n`)
    assert.equal(setB.status, 0, `${setB.stdout}\n${setB.stderr}`)

    const treeA = volumeTree(path.join(volumes, gitCredentialVolume("agentA")))
    const treeB = volumeTree(path.join(volumes, gitCredentialVolume("agentB")))
    assert.equal(treeA.includes(TOKEN_A), true)
    assert.equal(treeA.includes(TOKEN_B), false)
    assert.equal(treeA.includes(TOKEN_SHARED), false)
    assert.equal(treeA.includes("codex-from-shared"), true)
    assert.equal(treeB.includes(TOKEN_B), true)
    assert.equal(treeB.includes(TOKEN_A), false)
    assert.equal(treeB.includes(TOKEN_SHARED), false)
    const labelsA = fs.readFileSync(
      path.join(volumes, `${gitCredentialVolume("agentA")}.labels`),
      "utf8"
    )
    assert.equal(labelsA.includes("xiryn.agent=agentA"), true)
    assert.equal(labelsA.includes("agentB"), false)

    const showA = runGitToken(bin, volumes, ["show", "agentA"])
    assert.equal(showA.status, 0, showA.stderr)
    assert.match(
      showA.stdout,
      /^agent=agentA\s+host=github.com\s+user=agent-a\s+token=gith\*\*\*0111\n$/
    )
    assert.equal(showA.stdout.includes(TOKEN_A), false)
    const showShared = runGitToken(bin, volumes, ["show"])
    assert.match(
      showShared.stdout,
      /^shared\s+host=github.com\s+user=shared-user\s+token=gith\*\*\*0333\n$/
    )
    assert.equal(showShared.stdout.includes(TOKEN_SHARED), false)

    const urlSet = runGitToken(
      bin,
      volumes,
      ["set", "--stdin", "agentC"],
      `https://url-user:${TOKEN_A}@github.com\n`
    )
    assert.equal(urlSet.status, 0, `${urlSet.stdout}\n${urlSet.stderr}`)
    assert.equal(urlSet.stdout.includes(TOKEN_A), false)
    assert.equal(
      fs.readFileSync(
        path.join(volumes, gitCredentialVolume("agentC"), ".git-credentials"),
        "utf8"
      ),
      `https://url-user:${TOKEN_A}@github.com\n`
    )

    const listed = runGitToken(bin, volumes, ["list"])
    assert.equal(listed.status, 0, listed.stderr)
    assert.equal(listed.stdout.includes("agent=agentA"), true)
    assert.equal(listed.stdout.includes("agent=agentB"), true)
    assert.equal(listed.stdout.includes(TOKEN_A), false)
    assert.equal(listed.stdout.includes(TOKEN_B), false)

    const bad = runGitToken(bin, volumes, ["set", "../evil"], `user\n${TOKEN_A}\n`)
    assert.notEqual(bad.status, 0)
    assert.equal(bad.stdout.includes(TOKEN_A), false)
    assert.equal(bad.stderr.includes(TOKEN_A), false)
    assert.equal(fs.existsSync(path.join(volumes, "xiryn-git-creds-..")), false)

    const cleared = runGitToken(bin, volumes, ["clear", "agentA"])
    assert.equal(cleared.status, 0, `${cleared.stdout}\n${cleared.stderr}`)
    assert.equal(fs.existsSync(path.join(volumes, gitCredentialVolume("agentA"))), false)
    assert.equal(
      volumeTree(path.join(volumes, gitCredentialVolume("agentB"))).includes(TOKEN_B),
      true
    )
    assert.equal(
      fs
        .readFileSync(path.join(volumes, SHARED_GIT_VOLUME, ".git-credentials"), "utf8")
        .includes(TOKEN_SHARED),
      true
    )
    const dockerLog = fs.readFileSync(log, "utf8")
    assert.equal(dockerLog.includes(TOKEN_A), false)
    assert.equal(dockerLog.includes(TOKEN_B), false)
    assert.equal(dockerLog.includes(TOKEN_SHARED), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("shellcheck accepts the git credential scripts", (t) => {
  const found = spawnSync("bash", ["-lc", "command -v shellcheck"], { encoding: "utf8" })
  if (found.status !== 0) {
    t.skip("shellcheck is not installed")
    return
  }
  const setup = fs.readFileSync(path.join(repo, "scripts/setup-coding-tools.sh"), "utf8")
  const start = setup.indexOf("<<'EOF'\n")
  const end = setup.indexOf("\nEOF\n", start)
  assert.ok(start > 0 && end > start)
  const helper = setup.slice(start + "<<'EOF'\n".length, end)
  const helperFile = path.join(os.tmpdir(), "xiryn-git-credential-shellcheck.sh")
  fs.writeFileSync(helperFile, helper)
  const scripts = spawnSync(
    "shellcheck",
    [
      path.join(repo, "deploy/xiryn-git-token"),
      path.join(repo, "scripts/setup-coding-tools.sh"),
    ],
    { encoding: "utf8" }
  )
  const helperCheck = spawnSync("shellcheck", ["-s", "sh", helperFile], {
    encoding: "utf8",
  })
  fs.rmSync(helperFile, { force: true })
  assert.equal(scripts.status, 0, `${scripts.stdout}\n${scripts.stderr}`)
  assert.equal(helperCheck.status, 0, `${helperCheck.stdout}\n${helperCheck.stderr}`)
})
