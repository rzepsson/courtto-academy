import { env } from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// Runs once before the server suite. Applies the committed Drizzle migrations to
// the disposable test database named by TEST_DATABASE_URL. When that env var is
// absent the whole server suite is skipped (see test/server/helpers.ts), so this
// is a no-op rather than an error — `pnpm test:server` stays green for anyone
// without a Postgres to point at.
export default async function setup() {
  const url = env.TEST_DATABASE_URL

  if (!url) {
    console.warn(
      '\n[server tests] TEST_DATABASE_URL is not set — skipping the server integration suite.'
      + '\n                See TESTING.md for how to start a disposable Postgres.\n'
    )
    return
  }

  const sql = postgres(url, { max: 1 })

  try {
    await migrate(drizzle(sql), { migrationsFolder: './server/database/migrations' })
  } finally {
    await sql.end()
  }
}
