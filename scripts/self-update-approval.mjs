import Database from "better-sqlite3"

const dbFlag = process.argv.indexOf("--db")
const idFlag = process.argv.indexOf("--id")
const dbPath = process.argv[dbFlag + 1]
const id = process.argv[idFlag + 1]
const consume = process.argv.includes("--consume")
if (
  !dbPath ||
  !id ||
  !/^[A-Za-z0-9_-]{8,32}$/.test(id) ||
  dbPath.includes("..") ||
  (consume && process.argv.at(-1) !== "--consume")
) {
  process.exit(2)
}

const sqlite = new Database(dbPath, { readonly: !consume, fileMustExist: true })
const select = sqlite.prepare(
  "select tool, args, args_hash as argsHash, status, expires_at as expiresAt from action_approvals where id = ?"
)

function emit(row) {
  process.stdout.write(`${JSON.stringify(row ?? {})}\n`)
}

if (!consume) {
  emit(select.get(id))
  sqlite.close()
  process.exit(0)
}

sqlite.pragma("busy_timeout = 5000")
sqlite.exec("BEGIN IMMEDIATE")
try {
  const row = select.get(id)
  if (!row || row.status !== "approved") {
    sqlite.exec("ROLLBACK")
    sqlite.close()
    emit(row)
    process.exit(0)
  }
  const changed = sqlite
    .prepare(
      "update action_approvals set status = 'used' where id = ? and status = 'approved'"
    )
    .run(id)
  if (changed.changes !== 1) {
    sqlite.exec("ROLLBACK")
    sqlite.close()
    emit(select.get(id))
    process.exit(0)
  }
  sqlite.exec("COMMIT")
  sqlite.close()
  // The row we accepted. The table now says used, so a second consume refuses.
  emit(row)
} catch {
  try {
    sqlite.exec("ROLLBACK")
  } catch {
    // Already rolling back or the connection is closed.
  }
  sqlite.close()
  console.error("approval consume failed")
  process.exit(1)
}
