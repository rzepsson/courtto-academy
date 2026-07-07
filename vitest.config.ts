import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// A syntactically valid but non-routable connection string. `server/utils/db.ts`
// throws when DATABASE_URL is unset, but postgres-js connects lazily, so this
// placeholder lets the unit project import product modules (which pull in `db`)
// without ever opening a socket. The server project overrides it with a real
// TEST_DATABASE_URL.
const PLACEHOLDER_DB_URL = 'postgres://placeholder:placeholder@127.0.0.1:1/placeholder'

export default defineConfig({
  resolve: {
    alias: {
      '~~': resolvePath('./'),
      '@@': resolvePath('./'),
      '~': resolvePath('./app'),
      '@': resolvePath('./app')
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
          env: {
            DATABASE_URL: PLACEHOLDER_DB_URL
          }
        }
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['test/server/**/*.test.ts'],
          globalSetup: ['./test/server/global-setup.ts'],
          setupFiles: ['./test/server/setup.ts'],
          // These tests share one Postgres schema and truncate between files, so
          // they must not run concurrently.
          fileParallelism: false,
          sequence: {
            concurrent: false
          },
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            // Never fall back to the dev DATABASE_URL — a missing test DB skips
            // the suite rather than risking writes to a real database.
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? PLACEHOLDER_DB_URL
          }
        }
      }
    ]
  }
})
