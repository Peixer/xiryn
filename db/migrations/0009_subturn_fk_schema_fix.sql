-- Note: the FK constraint from parentThreadId → threads.id ON DELETE CASCADE
-- is already enforced at the SQLite level via migration 0008.
-- It is intentionally NOT declared via .references() in db/schema.ts because
-- Drizzle ORM's self-referential FK on the same table breaks type inference
-- on db.query.threads.findFirst() (all columns become `any`).
-- The SQL constraint is the source of truth; the schema comment documents it.
SELECT 1; -- no-op, advances migration state only
