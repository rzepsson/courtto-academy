// Postgres error introspection that survives Drizzle's error wrapping. Since
// drizzle-orm ≥ 0.36 a failed query throws a `DrizzleQueryError` whose real
// PostgresError (carrying `code` / `constraint_name`) sits in `.cause` — so a
// naive `error.code` check misses it and a unique/exclusion violation escapes
// as an unmapped 500 instead of a friendly 409. These helpers unwrap one level.

interface PgLike {
  code?: string
  constraint_name?: string
  constraint?: string
  cause?: unknown
}

function unwrap(error: unknown): PgLike | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const e = error as PgLike
  if (typeof e.code === 'string') return e
  if (e.cause && typeof e.cause === 'object') {
    const cause = e.cause as PgLike
    if (typeof cause.code === 'string') return cause
  }
  return undefined
}

// The SQLSTATE code of a (possibly Drizzle-wrapped) Postgres error, e.g. '23505'
// (unique_violation), '23P01' (exclusion_violation), '23514' (check_violation).
export function pgErrorCode(error: unknown): string | undefined {
  return unwrap(error)?.code
}

// The violated constraint's name, when the driver reports one (postgres-js uses
// `constraint_name`; some drivers use `constraint`).
export function pgErrorConstraint(error: unknown): string | undefined {
  const pg = unwrap(error)
  return pg?.constraint_name ?? pg?.constraint
}
