import Database from "better-sqlite3"

const dbFlag = process.argv.indexOf("--db")
const idFlag = process.argv.indexOf("--id")
const dbPath = process.argv[dbFlag + 1]
const id = process.argv[idFlag + 1]
if (!dbPath || !id || !/^[A-Za-z0-9_-]{8,32}$/.test(id) || dbPath.includes("..")) {
  process.exit(2)
}

const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
const row = sqlite
  .prepare(
    "select tool, args, args_hash as argsHash, status, expires_at as expiresAt from action_approvals where id = ?"
  )
  .get(id)
sqlite.close()
if (!row) {
  process.stdout.write("{}\n")
  process.exit(0)
}
process.stdout.write(`${JSON.stringify(row)}\n`)
