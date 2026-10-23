import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { skillTextForModel } from "./grokbot-import"
import {
  type GithubFetch,
  assertGithubAssetUrl,
  importGithubSkills,
  parseGithubSkillUrl,
  previewGithubSkills,
  readBoundedText,
} from "./github-skills"
import {
  SKILL_MAX_COUNT,
  formatSkillCatalog,
  loadSkillCatalog,
  readSkill,
  writeSkill,
} from "./skills"

const ROOT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const PSTACK = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const SKILLS = "cccccccccccccccccccccccccccccccccccccccc"
const FILE = "dddddddddddddddddddddddddddddddddddddddd"

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-github-skills-"))
}

function skillMd(
  name: string,
  description: string,
  body = "Do the thing.",
  source?: string
) {
  const extra = source ? `\nsource: ${source}` : ""
  return `---\nname: ${name}\ndescription: ${description}${extra}\n---\n\n${body}\n`
}

function treeUrl(owner: string, repo: string, id: string, recursive = false) {
  const base = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(id)}`
  return recursive ? `${base}?recursive=1` : base
}

function rawUrl(owner: string, repo: string, ref: string, file: string) {
  const head = ref.split("/").map(encodeURIComponent).join("/")
  const tail = file.split("/").map(encodeURIComponent).join("/")
  return `https://raw.githubusercontent.com/${owner}/${repo}/${head}/${tail}`
}

function listing(
  sha: string,
  entries: {
    path: string
    type: "tree" | "blob"
    sha: string
    mode?: string
    size?: number
  }[],
  truncated = false
) {
  return JSON.stringify({
    sha,
    truncated,
    tree: entries.map((entry) => ({
      path: entry.path,
      type: entry.type,
      sha: entry.sha,
      mode: entry.mode ?? (entry.type === "tree" ? "040000" : "100644"),
      ...(entry.size !== undefined ? { size: entry.size } : {}),
    })),
  })
}

function mock(
  routes: Record<string, { status?: number; body: string; remaining?: string }>
) {
  const calls: string[] = []
  const fetch: GithubFetch = async (url, kind) => {
    calls.push(`${kind} ${url}`)
    const hit = routes[url]
    if (!hit)
      return { status: 404, body: "missing", tooLarge: false, rateRemaining: null }
    return {
      status: hit.status ?? 200,
      body: hit.body,
      tooLarge: false,
      rateRemaining: hit.remaining ?? null,
    }
  }
  return { fetch, calls }
}

test("a skills folder link is parsed, and other links are refused", () => {
  const parsed = parseGithubSkillUrl(
    "https://github.com/cursor/plugins/tree/main/pstack/skills/"
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.value, {
    owner: "cursor",
    repo: "plugins",
    kind: "tree",
    segments: ["main", "pstack", "skills"],
  })

  const root = parseGithubSkillUrl("https://www.github.com/acme/widgets.git")
  assert.equal(root.ok, true)
  if (!root.ok) return
  assert.equal(root.value.repo, "widgets")
  assert.equal(root.value.kind, "root")

  const blob = parseGithubSkillUrl(
    "https://github.com/acme/widgets/blob/main/skills/architect/SKILL.md?raw=1"
  )
  assert.equal(blob.ok, true)
  if (!blob.ok) return
  assert.deepEqual(blob.value.segments, ["main", "skills", "architect", "SKILL.md"])

  const refused = [
    "https://evil.example/cursor/plugins",
    "http://github.com/acme/widgets",
    "https://user:pass@github.com/acme/widgets",
    "https://github.com:444/acme/widgets",
    "https://gist.github.com/acme/widgets",
    "https://github.com/acme/widgets/commit/abc",
    "https://github.com/acme/widgets/tree/main/%2e%2e%2fsecret",
    "https://github.com/acme/widgets/tree/main/..%2fsecret",
    "",
  ]
  for (const link of refused) {
    const result = parseGithubSkillUrl(link)
    assert.equal(result.ok, false, link)
  }
})

test("asset URLs stay on GitHub and oversize bodies stop", async () => {
  assert.equal(
    assertGithubAssetUrl("https://api.github.com/repos/acme/widgets", "api").hostname,
    "api.github.com"
  )
  assert.equal(
    assertGithubAssetUrl(
      "https://raw.githubusercontent.com/acme/widgets/main/SKILL.md",
      "raw"
    ).hostname,
    "raw.githubusercontent.com"
  )
  assert.throws(() => assertGithubAssetUrl("https://evil.example/skill", "api"))
  assert.throws(() =>
    assertGithubAssetUrl("https://api.github.com/repos/acme/widgets", "raw")
  )
  assert.throws(() =>
    assertGithubAssetUrl("https://user@api.github.com/repos/acme/widgets", "api")
  )
  assert.throws(() =>
    assertGithubAssetUrl("http://api.github.com/repos/acme/widgets", "api")
  )

  const small = await readBoundedText(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("ok"))
        controller.close()
      },
    }),
    10
  )
  assert.equal(small, "ok")
  await assert.rejects(
    () =>
      readBoundedText(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("abcdef"))
            controller.enqueue(Buffer.from("ghijk"))
            controller.close()
          },
        }),
        8
      ),
    /too large/
  )
})

test("a folder link previews SKILL.md files and skips the rest", async () => {
  const owner = "cursor"
  const repo = "plugins"
  const { fetch, calls } = mock({
    [treeUrl(owner, repo, "main")]: {
      body: listing(ROOT, [{ path: "pstack", type: "tree", sha: PSTACK }]),
    },
    [treeUrl(owner, repo, PSTACK)]: {
      body: listing(PSTACK, [{ path: "skills", type: "tree", sha: SKILLS }]),
    },
    [treeUrl(owner, repo, SKILLS, true)]: {
      body: listing(SKILLS, [
        { path: "architect/SKILL.md", type: "blob", sha: FILE, size: 120 },
        { path: "arena/SKILL.md", type: "blob", sha: FILE, size: 80 },
        { path: "broken/SKILL.md", type: "blob", sha: FILE, size: 20 },
        { path: "group/deep/SKILL.md", type: "blob", sha: FILE, size: 40 },
        { path: "huge/SKILL.md", type: "blob", sha: FILE, size: 200_000 },
        { path: "linked/SKILL.md", type: "blob", sha: FILE, size: 10, mode: "120000" },
        { path: "notes.md", type: "blob", sha: FILE, size: 10 },
        { path: "other/architect/SKILL.md", type: "blob", sha: FILE, size: 40 },
        { path: "node_modules/pkg/SKILL.md", type: "blob", sha: FILE, size: 40 },
      ]),
    },
    [rawUrl(owner, repo, "main", "pstack/skills/architect/SKILL.md")]: {
      body: skillMd("Architect", "Sketch first", "Stay in the loop.", "grokbot-import"),
    },
    [rawUrl(owner, repo, "main", "pstack/skills/arena/SKILL.md")]: {
      body: skillMd("Arena", "Compare options", "Run the comparison."),
    },
    [rawUrl(owner, repo, "main", "pstack/skills/broken/SKILL.md")]: {
      body: "# not a skill\n",
    },
    [rawUrl(owner, repo, "main", "pstack/skills/group/deep/SKILL.md")]: {
      body: skillMd("Deep", "Nested playbook", "Look underneath."),
    },
  })

  const root = tempRoot()
  const result = await previewGithubSkills(
    "https://github.com/cursor/plugins/tree/main/pstack/skills",
    { fetch, root }
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.preview.label, "cursor/plugins · main/pstack/skills")
  assert.equal(
    result.preview.htmlUrl,
    "https://github.com/cursor/plugins/tree/main/pstack/skills"
  )
  assert.deepEqual(
    result.preview.skills.map((skill) => skill.slug),
    ["architect", "arena", "deep"]
  )
  assert.equal(result.preview.skills[0]?.name, "Architect")
  assert.equal(result.preview.skills[0]?.body, "Stay in the loop.")
  assert.equal(result.preview.skills[0]?.canSave, true)
  assert.equal(result.preview.skills[0]?.replaced, false)
  const messages = result.preview.warnings.map((warning) => warning.message).join("\n")
  assert.match(messages, /larger than 16 KB/)
  assert.match(messages, /symlink/)
  assert.match(messages, /already uses the slug "architect"/)
  assert.match(messages, /frontmatter/)
  assert.equal(
    calls.some((call) => call.startsWith("raw ") && call.includes("huge")),
    false
  )
  assert.equal(
    calls.some((call) => call.includes("node_modules")),
    false
  )
  assert.equal(
    calls.every(
      (call) =>
        call.startsWith("api https://api.github.com/") ||
        call.startsWith("raw https://raw.githubusercontent.com/")
    ),
    true
  )
  fs.rmSync(root, { recursive: true, force: true })
})

test("a SKILL.md link and a slashed branch resolve", async () => {
  const file = mock({
    [treeUrl("acme", "widgets", "main")]: {
      body: listing(ROOT, [{ path: "SKILL.md", type: "blob", sha: FILE, size: 40 }]),
    },
    [rawUrl("acme", "widgets", "main", "SKILL.md")]: {
      body: skillMd("Widgets", "The repo skill", "From the root."),
    },
  })
  const single = await previewGithubSkills(
    "https://github.com/acme/widgets/blob/main/SKILL.md",
    { fetch: file.fetch }
  )
  assert.equal(single.ok, true)
  if (!single.ok) return
  assert.equal(single.preview.skills[0]?.slug, "widgets")
  assert.equal(
    single.preview.htmlUrl,
    "https://github.com/acme/widgets/blob/main/SKILL.md"
  )

  const branch = mock({
    [treeUrl("acme", "widgets", "feature/skills")]: {
      body: listing(SKILLS, [{ path: "pkg", type: "tree", sha: PSTACK }]),
    },
    [treeUrl("acme", "widgets", PSTACK, true)]: {
      body: listing(PSTACK, [{ path: "SKILL.md", type: "blob", sha: FILE, size: 30 }]),
    },
    [rawUrl("acme", "widgets", "feature/skills", "pkg/SKILL.md")]: {
      body: skillMd("Pkg", "Packaged", "Inside the branch."),
    },
  })
  const nested = await previewGithubSkills(
    "https://github.com/acme/widgets/tree/feature/skills/pkg",
    { fetch: branch.fetch }
  )
  assert.equal(nested.ok, true)
  if (!nested.ok) return
  assert.equal(nested.preview.ref, "feature/skills")
  assert.equal(nested.preview.skills[0]?.slug, "pkg")
  assert.equal(nested.preview.skills[0]?.body, "Inside the branch.")
})

test("a non-skill file, a private repo, and a rate limit are explained", async () => {
  const readme = mock({
    [treeUrl("acme", "widgets", "main")]: {
      body: listing(ROOT, [{ path: "README.md", type: "blob", sha: FILE, size: 10 }]),
    },
  })
  const notSkill = await previewGithubSkills(
    "https://github.com/acme/widgets/blob/main/README.md",
    { fetch: readme.fetch }
  )
  assert.equal(notSkill.ok, false)
  if (notSkill.ok) return
  assert.match(notSkill.error, /not a SKILL\.md/)

  let called = false
  const evil = await previewGithubSkills("https://evil.example/acme/widgets", {
    fetch: async () => {
      called = true
      throw new Error("should not fetch")
    },
  })
  assert.equal(evil.ok, false)
  assert.equal(called, false)

  const limited = mock({
    [treeUrl("acme", "widgets", "main")]: {
      status: 403,
      remaining: "0",
      body: JSON.stringify({ message: "API rate limit exceeded" }),
    },
  })
  const rate = await previewGithubSkills(
    "https://github.com/acme/widgets/tree/main/skills",
    {
      fetch: limited.fetch,
    }
  )
  assert.equal(rate.ok, false)
  if (rate.ok) return
  assert.match(rate.error, /rate-limited/)
})

test("import saves the selected skills and keeps them untrusted", async () => {
  const root = tempRoot()
  const routes = {
    [treeUrl("cursor", "plugins", "main")]: {
      body: listing(ROOT, [{ path: "pstack", type: "tree", sha: PSTACK }]),
    },
    [treeUrl("cursor", "plugins", PSTACK)]: {
      body: listing(PSTACK, [{ path: "skills", type: "tree", sha: SKILLS }]),
    },
    [treeUrl("cursor", "plugins", SKILLS, true)]: {
      body: listing(SKILLS, [
        { path: "architect/SKILL.md", type: "blob", sha: FILE, size: 80 },
        { path: "arena/SKILL.md", type: "blob", sha: FILE, size: 80 },
      ]),
    },
    [rawUrl("cursor", "plugins", "main", "pstack/skills/architect/SKILL.md")]: {
      body: skillMd("Architect", "Sketch first", "Stay in the loop.", "grokbot-import"),
    },
    [rawUrl("cursor", "plugins", "main", "pstack/skills/arena/SKILL.md")]: {
      body: skillMd("Arena", "Compare options", "Run the comparison."),
    },
  }
  const preview = await previewGithubSkills(
    "https://github.com/cursor/plugins/tree/main/pstack/skills",
    { fetch: mock(routes).fetch, root }
  )
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(
    preview.preview.skills.every((skill) => skill.replaced === false),
    true
  )

  writeSkill(
    { name: "Architect", description: "Old", body: "Old text", slug: "architect" },
    { root }
  )
  const again = await previewGithubSkills(
    "https://github.com/cursor/plugins/tree/main/pstack/skills",
    { fetch: mock(routes).fetch, root }
  )
  assert.equal(again.ok, true)
  if (!again.ok) return
  assert.equal(
    again.preview.skills.find((skill) => skill.slug === "architect")?.replaced,
    true
  )

  const imported = await importGithubSkills(
    "https://github.com/cursor/plugins/tree/main/pstack/skills",
    ["architect"],
    { fetch: mock(routes).fetch, root }
  )
  assert.equal(imported.ok, true)
  if (!imported.ok) return
  assert.equal(imported.imported.length, 1)
  assert.equal(imported.imported[0]?.replaced, true)
  const saved = readSkill("architect", { root })
  assert.equal(saved?.body, "Stay in the loop.")
  assert.equal(saved?.source, "github-import")
  assert.equal(readSkill("arena", { root }), null)
  const shown = skillTextForModel(saved ?? { body: "" })
  assert.match(shown.body, /<untrusted source="github-skill">/)
  assert.match(shown.note, /untrusted data/)
  assert.equal(shown.body.includes("grokbot-skill"), false)

  const catalog = formatSkillCatalog(loadSkillCatalog({ root }))
  assert.match(catalog, /Architect \(slug: architect, imported\): Sketch first/)
  assert.match(catalog, /untrusted data/)

  writeSkill(
    {
      name: "Architect",
      description: "Sketch first",
      body: "Stay in the loop.",
      slug: "architect",
    },
    { root, replace: true }
  )
  assert.equal(readSkill("architect", { root })?.source, undefined)

  const refused = await importGithubSkills(
    "https://github.com/cursor/plugins/tree/main/pstack/skills",
    ["../etc"],
    {
      fetch: async () => {
        throw new Error("should not fetch")
      },
      root,
    }
  )
  assert.equal(refused.ok, false)
  fs.rmSync(root, { recursive: true, force: true })
})

test("a full library can replace a skill and cannot add one", async () => {
  const root = tempRoot()
  for (let i = 0; i < SKILL_MAX_COUNT; i++) {
    writeSkill({ name: `Skill ${i}`, description: "Saved", body: "note" }, { root })
  }
  const routes = {
    [treeUrl("acme", "widgets", "main")]: {
      body: listing(ROOT, [{ path: "skills", type: "tree", sha: SKILLS }]),
    },
    [treeUrl("acme", "widgets", SKILLS, true)]: {
      body: listing(SKILLS, [
        { path: "skill-0/SKILL.md", type: "blob", sha: FILE, size: 40 },
        { path: "brand-new/SKILL.md", type: "blob", sha: FILE, size: 40 },
      ]),
    },
    [rawUrl("acme", "widgets", "main", "skills/skill-0/SKILL.md")]: {
      body: skillMd("Skill 0", "Saved", "updated"),
    },
    [rawUrl("acme", "widgets", "main", "skills/brand-new/SKILL.md")]: {
      body: skillMd("Brand new", "Extra", "no room"),
    },
  }
  const preview = await previewGithubSkills(
    "https://github.com/acme/widgets/tree/main/skills",
    { fetch: mock(routes).fetch, root }
  )
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(
    preview.preview.skills.find((skill) => skill.slug === "skill-0")?.canSave,
    true
  )
  assert.equal(
    preview.preview.skills.find((skill) => skill.slug === "brand-new")?.canSave,
    false
  )
  const imported = await importGithubSkills(
    "https://github.com/acme/widgets/tree/main/skills",
    ["skill-0", "brand-new"],
    { fetch: mock(routes).fetch, root }
  )
  assert.equal(imported.ok, true)
  if (!imported.ok) return
  assert.deepEqual(
    imported.imported.map((skill) => skill.slug),
    ["skill-0"]
  )
  assert.equal(readSkill("skill-0", { root })?.body, "updated")
  assert.equal(readSkill("brand-new", { root }), null)
  assert.match(imported.warnings.map((warning) => warning.message).join(" "), /64/)
  fs.rmSync(root, { recursive: true, force: true })
})
