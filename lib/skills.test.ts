import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  SKILL_CATALOG_LIMIT,
  SKILL_MAX_BYTES,
  SKILL_MAX_COUNT,
  SkillError,
  deleteSkill,
  exportSkillsBundle,
  formatSkillCatalog,
  importSkillsText,
  listSkills,
  loadSkillCatalog,
  normalizeSlug,
  parseSkillMarkdown,
  readSkill,
  writeSkill,
} from "./skills"

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-skills-"))
}

function skillFile(name: string, description: string, body = "Body") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

test("frontmatter parses name, description, and body", () => {
  const parsed = parseSkillMarkdown(`---
name: Invoice filing
description: How I want invoices filed
---

Save PDFs in the invoices folder.
`)
  assert.equal(parsed.name, "Invoice filing")
  assert.equal(parsed.description, "How I want invoices filed")
  assert.equal(parsed.body, "Save PDFs in the invoices folder.")
})

test("frontmatter accepts quotes and folded text", () => {
  const quoted = parseSkillMarkdown(`---
name: "Notes: tax"
description: 'Use the "2024" folder'
---
Keep the year in the filename.
`)
  assert.equal(quoted.name, "Notes: tax")
  assert.equal(quoted.description, 'Use the "2024" folder')
  assert.equal(quoted.body, "Keep the year in the filename.")

  const block = parseSkillMarkdown(`---
name: Weekly
description: |
  First line
  Second line
---
Body
`)
  assert.equal(block.description, "First line\nSecond line")
  assert.equal(block.body, "Body")
})

test("frontmatter errors are explicit", () => {
  assert.throws(
    () => parseSkillMarkdown("# no frontmatter\n"),
    (error: unknown) =>
      error instanceof SkillError && /YAML frontmatter/.test(error.message)
  )
  assert.throws(
    () => parseSkillMarkdown("---\nname: Only a name\n---\n\nBody\n"),
    (error: unknown) =>
      error instanceof SkillError &&
      error.message === "Frontmatter is missing a description."
  )
  assert.throws(
    () => parseSkillMarkdown("---\ndescription: No name\n---\n\nBody\n"),
    (error: unknown) =>
      error instanceof SkillError && error.message === "Frontmatter is missing a name."
  )
  assert.throws(
    () => parseSkillMarkdown("---\nname: Open\ndescription: Never closed"),
    (error: unknown) =>
      error instanceof SkillError && /YAML frontmatter/.test(error.message)
  )
  assert.throws(
    () =>
      parseSkillMarkdown(
        `---\nname: "${"n".repeat(81)}"\ndescription: Ok\n---\n\nBody\n`
      ),
    (error: unknown) =>
      error instanceof SkillError && /name must be 80/.test(error.message)
  )
})

test("slug normalization", () => {
  assert.equal(normalizeSlug("Invoice Filing"), "invoice-filing")
  assert.equal(normalizeSlug("  Hello, World! "), "hello-world")
  assert.equal(normalizeSlug("Facturación"), "facturacion")
  assert.equal(normalizeSlug("---notes---"), "notes")
  assert.throws(
    () => normalizeSlug("../etc/passwd"),
    (error: unknown) => error instanceof SkillError && /not allowed/.test(error.message)
  )
  assert.throws(
    () => normalizeSlug("..."),
    (error: unknown) => error instanceof SkillError && /not allowed/.test(error.message)
  )
  assert.throws(
    () => normalizeSlug("!!!"),
    (error: unknown) =>
      error instanceof SkillError && /letter or number/.test(error.message)
  )
  assert.throws(() => normalizeSlug(""), SkillError)
})

test("../ traversal is rejected", () => {
  const root = tempRoot()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-skills-outside-"))
  const secret = path.join(outside, "SKILL.md")
  fs.writeFileSync(secret, "secret")
  const slugs = [
    "../etc",
    "..",
    "foo/../../etc",
    "foo\\..\\bar",
    "/etc/passwd",
    "a/b",
    ".",
  ]
  for (const slug of slugs) {
    assert.throws(() => readSkill(slug, { root }), SkillError)
    assert.throws(
      () => writeSkill({ slug, name: "N", description: "D", body: "B" }, { root }),
      SkillError
    )
    assert.throws(() => deleteSkill(slug, { root }), SkillError)
  }
  assert.equal(fs.readFileSync(secret, "utf8"), "secret")
  assert.equal(
    fs.readdirSync(root).some((name) => name.includes("..")),
    false
  )
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

test("symlinks are not followed", () => {
  const root = tempRoot()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xiryn-skills-link-"))
  fs.writeFileSync(path.join(outside, "secret.md"), "top secret")
  fs.writeFileSync(path.join(outside, "SKILL.md"), skillFile("Hidden", "Do not load"))
  const linked = path.join(root, "linked")
  fs.mkdirSync(linked)
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(linked, "SKILL.md"))
  fs.symlinkSync(outside, path.join(root, "escape"))

  const library = listSkills({ root })
  assert.equal(library.skills.length, 0)
  assert.equal(JSON.stringify(library).includes("top secret"), false)
  assert.equal(JSON.stringify(library).includes("Hidden"), false)
  assert.ok(library.warnings.some((warning) => warning.slug === "linked"))
  assert.ok(library.warnings.some((warning) => warning.slug === "escape"))
  assert.throws(() => readSkill("linked", { root }), SkillError)
  const outsideFile = fs.readFileSync(path.join(outside, "SKILL.md"), "utf8")
  assert.throws(
    () =>
      writeSkill(
        { slug: "escape", name: "Nope", description: "No", body: "No" },
        { root }
      ),
    SkillError
  )
  assert.equal(fs.readFileSync(path.join(outside, "SKILL.md"), "utf8"), outsideFile)
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

test("size and count caps are enforced", () => {
  const root = tempRoot()
  writeSkill({ name: "Ok", description: "Short", body: "x" }, { root })
  assert.throws(
    () =>
      writeSkill(
        { name: "Big", description: "Short", body: "x".repeat(SKILL_MAX_BYTES) },
        { root }
      ),
    (error: unknown) => error instanceof SkillError && /16 KB/.test(error.message)
  )

  for (let i = 0; i < SKILL_MAX_COUNT - 1; i++) {
    writeSkill({ name: `Skill ${i}`, description: "Short", body: "note" }, { root })
  }
  assert.equal(listSkills({ root }).skills.length, SKILL_MAX_COUNT)
  assert.throws(
    () => writeSkill({ name: "One more", description: "Short", body: "note" }, { root }),
    (error: unknown) =>
      error instanceof SkillError && new RegExp(`${SKILL_MAX_COUNT}`).test(error.message)
  )
  const replaced = writeSkill(
    { name: "Ok", description: "Short", body: "updated", slug: "ok" },
    { root, replace: true }
  )
  assert.equal(replaced.replaced, true)
  assert.equal(readSkill("ok", { root })?.body, "updated")
  fs.rmSync(root, { recursive: true, force: true })
})

test("files already over the cap are skipped", () => {
  const root = tempRoot()
  for (let i = 0; i < SKILL_MAX_COUNT + 1; i++) {
    const slug = `s${String(i).padStart(2, "0")}`
    fs.mkdirSync(path.join(root, slug))
    fs.writeFileSync(path.join(root, slug, "SKILL.md"), skillFile(`S${i}`, "Kept"))
  }
  const library = listSkills({ root })
  assert.equal(library.skills.length, SKILL_MAX_COUNT)
  assert.ok(
    library.warnings.some((warning) => warning.message.includes(`${SKILL_MAX_COUNT}`))
  )
  fs.rmSync(root, { recursive: true, force: true })
})

test("a malformed file is skipped with a warning", () => {
  const root = tempRoot()
  writeSkill(
    {
      name: "Invoice filing",
      description: "How I want invoices filed",
      body: "Save PDFs.",
    },
    { root }
  )
  fs.mkdirSync(path.join(root, "broken"))
  fs.writeFileSync(path.join(root, "broken", "SKILL.md"), "# not a skill\n")
  const library = listSkills({ root })
  assert.deepEqual(
    library.skills.map((skill) => skill.slug),
    ["invoice-filing"]
  )
  assert.equal(library.warnings.length, 1)
  assert.equal(library.warnings[0]?.slug, "broken")
  assert.match(library.warnings[0]?.message ?? "", /frontmatter/)
  fs.rmSync(root, { recursive: true, force: true })
})

test("catalog keeps 40 skills and says how many were left out", () => {
  const root = tempRoot()
  for (let i = 0; i < SKILL_CATALOG_LIMIT + 1; i++) {
    writeSkill(
      {
        name: `Playbook ${String(i).padStart(2, "0")}`,
        description: "A step",
        body: "Do it.",
      },
      { root }
    )
  }
  const catalog = loadSkillCatalog({ root })
  assert.equal(catalog.skills.length, SKILL_CATALOG_LIMIT)
  assert.equal(catalog.omitted, 1)
  const text = formatSkillCatalog(catalog)
  assert.equal(text.match(/^- /gm)?.length, SKILL_CATALOG_LIMIT)
  assert.match(text, /1 more skill is not listed/)
  assert.match(text, /Playbook 00/)
  assert.doesNotMatch(text, /Playbook 40/)
  fs.rmSync(root, { recursive: true, force: true })
})

test("readSkill returns the body a skill_read call would hand back", () => {
  const root = tempRoot()
  writeSkill(
    {
      name: "Invoice filing",
      description: "How I want invoices filed",
      body: "Save PDFs in the invoices folder.",
    },
    { root }
  )
  const skill = readSkill("invoice-filing", { root })
  assert.ok(skill)
  assert.equal(skill.body, "Save PDFs in the invoices folder.")
  const catalog = formatSkillCatalog(loadSkillCatalog({ root }))
  assert.match(
    catalog,
    /Invoice filing \(slug: invoice-filing\): How I want invoices filed/
  )
  assert.doesNotMatch(catalog, /Save PDFs/)
  fs.rmSync(root, { recursive: true, force: true })
})

test("export and import round-trip", () => {
  const root = tempRoot()
  const other = tempRoot()
  writeSkill({ name: "Alpha", description: "First", body: "One" }, { root })
  writeSkill({ name: "Beta", description: "Second", body: "Two" }, { root })
  const bundle = exportSkillsBundle({ root })
  const imported = importSkillsText(bundle, { root: other })
  assert.equal(imported.imported.length, 2)
  assert.equal(readSkill("beta", { root: other })?.body, "Two")
  const again = importSkillsText(skillFile("Alpha", "First", "Changed"), {
    root: other,
    filename: "alpha.md",
  })
  assert.equal(again.imported[0]?.replaced, true)
  assert.equal(readSkill("alpha", { root: other })?.body, "Changed")
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(other, { recursive: true, force: true })
})
