// Argument parsing for scripts/import-grokbot.ts. No database and no network.

export function parseGrokbotCli(
  argv: string[]
):
  | { ok: true; dryRun: boolean; source: string; stdin: boolean }
  | { ok: false; error: string } {
  const dryRun = argv.includes("--dry-run")
  const rest = argv.filter((arg) => arg !== "--dry-run")
  if (rest.length === 0 || rest.includes("-h") || rest.includes("--help")) {
    return {
      ok: false,
      error:
        "Usage: npx tsx scripts/import-grokbot.ts <file.json | https://share-link | -> [--dry-run]",
    }
  }
  if (rest.length !== 1) {
    return { ok: false, error: "Pass one file, one https link, or - for stdin." }
  }
  const source = rest[0]
  if (source === "-" || source === "--stdin") {
    return { ok: true, dryRun, source: "", stdin: true }
  }
  return { ok: true, dryRun, source, stdin: false }
}
