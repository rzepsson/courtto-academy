import { env } from 'node:process'
import { defineConfig, devices } from '@playwright/test'

// Better Auth's BETTER_AUTH_URL must match the served origin or every org
// mutation is rejected with 403 INVALID_ORIGIN — so the app is always served on
// port 3000.
const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`

// This dev box has a cached Chromium that predates the one @playwright/test
// pins, so allow pointing Playwright at an explicit binary instead of forcing a
// download. On CI, `playwright install chromium` provides the matching build and
// this stays unset. See TESTING.md.
const executablePath = env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const launchOptions = executablePath ? { executablePath } : {}

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/e2e/support/global-setup.ts',
  // The app + Better Auth share one origin and one database; running specs
  // serially keeps sessions and truncation deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(env.CI),
  retries: env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    launchOptions
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions }
    }
  ],
  webServer: {
    // `--dotenv .env.e2e` isolates the run from the dev `.env` (and its real
    // database). Create .env.e2e per TESTING.md before running e2e.
    command: `pnpm exec nuxt dev --dotenv .env.e2e --port ${PORT}`,
    port: PORT,
    // Never silently reuse a dev server that may be pointed at the real DB.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
