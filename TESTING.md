# Testing

courtto academy has three test tiers. The security-critical logic — roles, area
routing, `requireActiveMembership`, invitation masking/expiry, multi-tenant
isolation — is covered by the unit and server tiers, which run in CI. The e2e
tier drives the real app and is run locally.

| Tier | Tool | DB? | Command | CI |
| --- | --- | --- | --- | --- |
| Unit | Vitest (`unit` project) | no | `pnpm test` | yes |
| Server integration | Vitest (`server` project) | yes | `pnpm test:server` | yes |
| E2E | Playwright | yes + running app | `pnpm test:e2e` | no (local) |

```
test/
  unit/     pure functions — permissions, org utils, format, email mask
  server/   real Postgres — requireActiveMembership, service queries, isolation
  e2e/      Playwright — signup/onboarding, role routing, permission denial,
            cross-user cache isolation
```

Vitest config lives in `vitest.config.ts` (two projects sharing `~`/`~~`
aliases). Playwright config lives in `playwright.config.ts`.

## Unit tier — `pnpm test`

Pure functions only. No database, no Nuxt runtime — plain Vitest with the repo's
path aliases. Fast (<1s) and always runnable. `pnpm test:watch` for TDD.

The two module-private helpers in `server/utils/services/membership.ts`
(`maskEmail`, `toOrgRole`) are exported so they can be unit-tested. Importing
that module pulls in `server/utils/db.ts`, but postgres-js connects lazily, so a
placeholder `DATABASE_URL` (set in `vitest.config.ts`) means no socket is opened.

## Server tier — `pnpm test:server`

Runs the real service queries and `requireActiveMembership` against a real
Postgres, seeding **through Better Auth's server API** (`auth.api.*`) — never
direct Drizzle inserts (CLAUDE.md rule 4). The one exception is
`expireInvitation()` in `test/server/helpers.ts`, a deliberate test-only `UPDATE`
that ages an invitation into the past (there is no API to set a past expiry).

It is gated on **`TEST_DATABASE_URL`**:

- **Set** → migrations are applied (`test/server/global-setup.ts`), tables are
  truncated before each test, suites run.
- **Unset** → every server suite is skipped with a notice. `pnpm test:server`
  stays green. It never falls back to the dev `DATABASE_URL`, so a real database
  is never touched.

Start a disposable Postgres (Docker):

```bash
docker run -d --name courtto-test-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=courtto_test \
  -p 55432:5432 postgres:16-alpine

export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/courtto_test"
pnpm test:server
```

Any reachable throwaway Postgres works (local install, Testcontainers, a CI
service). Do **not** point it at the dev/Supabase database.

## E2E tier — `pnpm test:e2e`

Playwright starts the app itself and drives Chromium. Because Better Auth rejects
mismatched origins, the app is always served on **port 3000** (matching
`BETTER_AUTH_URL`). Setup:

1. **Isolate the app from the dev database.** Playwright starts the app with
   `nuxt dev --dotenv .env.e2e`, so create `.env.e2e` in the repo root pointing
   at a disposable Postgres (it is git-ignored):

   ```
   DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/courtto_e2e"
   BETTER_AUTH_SECRET="e2e-test-secret-not-for-production"
   BETTER_AUTH_URL="http://localhost:3000"
   ```

   Create the database once: `docker exec courtto-test-pg psql -U postgres -c "CREATE DATABASE courtto_e2e"`.

2. **Point the test runner at the same DB** so it can migrate and truncate:
   `export E2E_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/courtto_e2e"`.

3. **Free port 3000.** The runner never reuses an existing server (it might be on
   the dev DB), so stop any `pnpm dev` first.

4. **Browser binary.** This dev box has a cached Chromium that predates the one
   `@playwright/test` pins. Point Playwright at it instead of downloading:

   ```bash
   export PLAYWRIGHT_CHROMIUM_PATH="$HOME/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe"
   ```

   Elsewhere, run `pnpm exec playwright install chromium` once and leave the var
   unset.

Then:

```bash
pnpm test:e2e            # full run
pnpm exec playwright test --list   # just enumerate specs (no server, no DB)
```

Seed/login fixtures live in `test/e2e/fixtures.ts`: `createUser`, `createOrg`,
`invite`, `acceptInvite` (all via `/api/auth/*` with a cookie jar and an `Origin`
header) and `authenticate` (replays the cookie jar into a browser context). An
autouse fixture truncates the e2e database before every test.

E2E is kept out of CI for now (it needs a built app + browser on port 3000); the
unit + server tiers guard the security-critical logic there.

## Gotchas

- **Port 3000 / Origin.** Better Auth 403s org mutations whose `Origin` ≠
  `BETTER_AUTH_URL`. Serve on 3000; seed requests send the `Origin` header.
  Sign-up/sign-in do not require it, so a green signup can still hide a bad
  origin — that's why the seed helpers set it everywhere.
- **Never touch the dev DB.** Server tests skip without `TEST_DATABASE_URL`; the
  e2e app runs off `.env.e2e`. Neither falls back to `.env`.
- **Hydration race (e2e).** Clicking a form submit before Vue hydrates fires a
  native GET reload instead of the client handler. `waitForHydration()`
  (in `fixtures.ts`) waits for `#__nuxt`'s `__vue_app__` before interacting.
