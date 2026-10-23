import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  createBackup,
  defaultDataDir,
  defaultOutDir,
  describeVaultKey,
  parseBackupArgs,
  restoreBackup,
  verifyBackup,
} from "../lib/backup"

// `npm run backup`. Notices go to stderr so a caller can read the directory
// path from stdout. Key material is never printed.

async function main() {
  const dataDir = defaultDataDir()
  const command = parseBackupArgs(process.argv.slice(2))
  if (command.kind === "verify") {
    const result = verifyBackup(path.resolve(command.dir))
    console.log(`Backup ok (${result.files} files)`)
    return
  }
  if (command.kind === "restore") {
    const result = restoreBackup({
      directory: path.resolve(command.dir),
      target: path.resolve(command.target),
      liveDataDir: dataDir,
    })
    for (const notice of result.notices) console.error(notice)
    console.log(`Restored to ${result.target}`)
    return
  }
  const result = await createBackup({
    dataDir,
    outDir: command.out ? path.resolve(command.out) : defaultOutDir(dataDir),
    keep: command.keep,
    includeVaultKey: command.includeVaultKey,
    vault: describeVaultKey({
      dataDir,
      env: process.env,
      homeDir: os.homedir(),
      platform: process.platform,
      docker: fs.existsSync("/.dockerenv"),
    }),
  })
  for (const notice of result.notices) console.error(notice)
  console.log(result.directory)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backup failed")
  process.exitCode = 1
})
