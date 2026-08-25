// Applies the committed Drizzle migrations. Plain ESM (no TypeScript, no jiti) so
// it can run inside the production image with nothing installed beyond what Nitro
// already traced into `.output/server/node_modules` — `drizzle-orm` and `postgres`
// are both runtime dependencies, so there is no second dependency tree to ship.
//
// Deliberately the SAME mechanism the server test suite uses
// (test/server/global-setup.ts): the migrator that is exercised against a real
// Postgres on every CI run is the one that touches production. `drizzle-kit` is a
// devDependency and is never needed here.
//
// Runs from two places, which is why the folder is resolved rather than hardcoded:
//   - inside the image, next to this file (`.output/server/migrations`)
//   - from a checkout, e.g. to migrate production from a laptop:
//     DATABASE_URL=... node scripts/migrate.mjs
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, exit } from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))

const migrationsFolder = [
  resolve(here, 'migrations'),
  resolve(here, '../server/database/migrations')
].find(existsSync)

if (!migrationsFolder) {
  console.error('[migrate] no migrations folder found next to the script or in the repository')
  exit(1)
}

const url = env.DATABASE_URL

if (!url) {
  console.error('[migrate] DATABASE_URL is not set')
  exit(1)
}

// max: 1 — migrations must run on a single connection, in order.
const sql = postgres(url, { max: 1 })

try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`)
  await migrate(drizzle(sql), { migrationsFolder })
  console.log('[migrate] up to date')
} catch (error) {
  // Fail loudly and non-zero: the container command chains on success, so a failed
  // migration must stop the app from starting against a half-migrated schema.
  console.error('[migrate] failed:', error)
  await sql.end({ timeout: 5 }).catch(() => undefined)
  exit(1)
}

await sql.end()
