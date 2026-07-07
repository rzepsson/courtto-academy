import { env } from 'node:process'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// The e2e app server is started with `--dotenv .env.e2e`, so its DATABASE_URL
// comes from that file — never the dev `.env`. We read the same value here (as
// E2E_DATABASE_URL) purely to migrate and truncate between specs. If it is
// unset we bail loudly rather than risk touching a real database.
export const E2E_DATABASE_URL = env.E2E_DATABASE_URL ?? ''

function requireUrl(): string {
  if (!E2E_DATABASE_URL) {
    throw new Error(
      'E2E_DATABASE_URL is not set. Point it at the same disposable Postgres as .env.e2e. See TESTING.md.'
    )
  }
  return E2E_DATABASE_URL
}

export async function migrateE2eDb(): Promise<void> {
  const client = postgres(requireUrl(), { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: './server/database/migrations' })
  } finally {
    await client.end()
  }
}

export async function resetE2eDb(): Promise<void> {
  const client = postgres(requireUrl(), { max: 1 })
  try {
    await client.unsafe(
      'TRUNCATE TABLE "invitation", "member", "session", "account", "verification", "organization", "user" RESTART IDENTITY CASCADE'
    )
  } finally {
    await client.end()
  }
}

// Re-exported so specs can build ad-hoc queries if ever needed.
export { sql }
