import { createHash } from "node:crypto"

const ACCOUNT = /^[0-9a-f]{16}$/

// The vault key file is `vault-<account>.key`. Blue and green have different
// database paths, so a name taken from the path changes on every switch and
// no longer matches the key created for /opt/xiryn/data/xiryn.db. The
// installer pins the old name in XIRYN_VAULT_ACCOUNT. Anything else still
// hashes the database path, which is what a single install already does.
export function vaultAccount(dbPath: string, configured?: string | null) {
  const fromEnv = configured?.trim() ?? ""
  if (ACCOUNT.test(fromEnv)) return fromEnv
  return createHash("sha256").update(dbPath).digest("hex").slice(0, 16)
}
