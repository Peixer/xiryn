const TITLE = /[\u0000-\u001f\u007f]/g

export function summarizeChangelog(input: {
  commits: { sha: string; title: string }[]
  migrationPaths: string[]
}) {
  const titles = input.commits
    .map((commit) => commit.title.replace(TITLE, " ").trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((title) => (title.length > 140 ? `${title.slice(0, 139)}…` : title))
  const migrations = input.migrationPaths
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /^db\/migrations\/[^/]+\.sql$/.test(file))
    .map((file) => file.slice("db/migrations/".length))
  return {
    titles,
    migrations,
    includesMigrations: migrations.length > 0,
  }
}
