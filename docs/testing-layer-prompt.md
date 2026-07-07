# Prompt — build the automated testing layer for courtto-academy

Paste everything below the line into a fresh session (ideally on a dedicated
branch). It is self-contained: it assumes no memory of prior conversations.

---

You are a senior test engineer. Build the **automated testing layer** for this
repo — it is currently the #1 gap: a multi-tenant B2B SaaS with role-based
authorization and **zero automated tests**. A regression in the permission/role
logic would ship silently. Read `CLAUDE.md` first; follow its conventions exactly.

## What this app is (orient yourself, don't take my word — read the code)

- **Stack:** Nuxt 4 (`srcDir: app/`, Nitro `server/` at root) · Nuxt UI 4 · Drizzle ORM (PostgreSQL, postgres-js) · Better Auth with the `organization` plugin · @nuxtjs/i18n (en/pl). Package manager **pnpm**. Windows dev host (PowerShell + git-bash both available).
- **Domain:** each tennis/padel school is a Better Auth *organization* (tenant). Per-membership roles `owner|admin|coach|student|parent` live once in `shared/permissions.ts`. Role→area routing: owner/admin→`/school`, coach→`/coach`, student/parent→`/my`.
- **Security-critical logic** (test this hardest):
  - `shared/permissions.ts` — `roleArea`, `roleHome`, `resolveActiveMembership`, `isOrgRole`, `AREA_ROLES`, `INVITABLE_ROLES`.
  - `server/utils/org.ts` — `requireActiveMembership(event, allowedRoles?)`: server-side authz; resolves the active org from the session (find-or-first), 403s on missing membership / insufficient role.
  - `server/utils/services/membership.ts` — read queries; `maskEmail`, `toOrgRole` (module-private — export them or test via the public functions), and `listPendingInvitations` filters out expired invites.
  - `app/utils/org.ts` — `activeMembershipOf`, `sanitizeRedirect`, `slugify`, `extractInvitationId`, `validateSchoolForm`.
  - `app/utils/format.ts` — `formatDate`.
- **Invitations** are copyable `/invite/[id]` links; `GET /api/invitations/[id]` is public (masked email). Accept/reject via `authClient.organization.*`; Better Auth enforces the signed-in email matches the invite.

## Test pyramid to build (in this priority order)

1. **Unit (Vitest, no DB, fast) — do this first, highest ROI.**
   Cover every pure function above. Priority cases:
   - `roleArea` maps each role correctly **and** falls back to `'my'` for an unknown/legacy role (this prevents a redirect loop — assert it).
   - `resolveActiveMembership`: picks the active org when present; falls back to first membership when the active id is stale/missing/undefined; returns null on empty.
   - `toOrgRole`: coerces unknown DB strings (e.g. `'member'`) to a safe role.
   - `maskEmail`: never leaks the local part beyond the first char.
   - `sanitizeRedirect`: rejects `//evil.com`, external URLs, non-strings; allows internal paths.
   - `extractInvitationId`: parses a full invite URL and a bare id; rejects junk.
   - `validateSchoolForm` / slug regex: accepts valid slugs, rejects uppercase/spaces/leading-trailing dashes; `slugify` handles Polish diacritics (ł, ą, …).
   Use `@nuxt/test-utils` (nuxt-vitest) only where auto-imports/Nuxt context are needed; prefer plain Vitest with explicit imports for pure functions.

2. **Server integration (Vitest + a real test Postgres).**
   - `requireActiveMembership`: allowed role passes; disallowed role 403s; no membership 403s; stale active-org id falls back to a real membership (does **not** 403 a user who still has another school).
   - `listPendingInvitations`: an expired invitation (expiresAt in the past) is **excluded**; a fresh one is included.
   - Multi-tenant isolation: user in org A cannot read org B's members/invitations.
   Seed data through Better Auth's API (`auth.api.*`) / `authClient`, **never** direct Drizzle inserts (Better Auth owns those tables — see CLAUDE.md rule 4). Point `DATABASE_URL` at a disposable test database; run `pnpm db:migrate` against it; truncate/clean between tests. Testcontainers-postgres is acceptable if you prefer hermetic runs.

3. **E2E (Playwright) — the flows that matter end-to-end.**
   - signup → create school → redirected to `/school`; role home routing for each role.
   - invite (owner) → accept (invitee, matching email) → lands in their role area; wrong-email accept is rejected.
   - permission denial: a coach hitting `/api/school/members` gets 403; a guest gets 401; a coach visiting `/school` is redirected to `/coach` (no loop).
   - **cross-user cache isolation** (regression test for a fixed bug): in ONE browser context, sign in as user A (school "A"), sign out, sign in as user B (school "B") *without a hard refresh* — the dashboard must show B's school, never A's.

## Environment gotchas (these cost hours if missed)

- **Port must match `BETTER_AUTH_URL`.** `.env` has `BETTER_AUTH_URL=http://localhost:3000`. Run the app on **port 3000** or Better Auth rejects every org mutation with `403 INVALID_ORIGIN`. Org-mutation routes also require an `Origin: http://localhost:3000` header (curl/fetch), while sign-up/sign-in do not — so a passing signup can mask a misconfigured origin.
- **Better Auth CSRF:** for programmatic seeding via `POST /api/auth/organization/*`, send the `Origin` header and reuse a cookie jar.
- **Page transitions are disabled** (`app.pageTransition: false`); don't reintroduce them (they broke async client nav).
- A **Playwright harness already works** in this environment: launch the cached Chromium at `~/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe` via `playwright-core` (install it in a scratch dir, not the project). Seed users/orgs through `/api/auth/*` with a curl cookie jar, convert the Netscape jar (note `#HttpOnly_` prefix + CRLF) to Playwright cookies, and `context.addCookies(...)`, or drive the real login form. `.claude/skills/verify/SKILL.md` documents the curl flows.
- Do **not** pollute the dev database — use a dedicated test DB and clean up.

## Deliverables

- `vitest.config.ts` (+ `@nuxt/test-utils` wiring), unit + integration test files under a conventional layout (e.g. `test/unit/**`, `test/server/**`).
- `playwright.config.ts` + e2e specs under `test/e2e/**`, with reusable seed/teardown fixtures (create-user, create-org, set-active, invite).
- `package.json` scripts: `test` (unit), `test:server`, `test:e2e`, `test:watch`.
- Update `.github/workflows/ci.yml` to run unit + server tests (spin up a Postgres service container; run migrations). Keep e2e in CI only if you can make it reliable; otherwise document how to run it locally.
- A short `TESTING.md` (how to run each tier, test DB setup, the gotchas above).
- Update `CLAUDE.md` with a "Testing" section describing the tooling and how to run it.

## Constraints & definition of done

- `pnpm typecheck` and `pnpm lint` stay green; new tests are part of the gate.
- Tests are deterministic and isolated (no shared mutable state, no reliance on dev-DB contents).
- Prefer testing behavior through public surfaces over restructuring product code; if a function must be exported to be testable, that's fine, but don't change runtime behavior.
- When done, run the full suite and report results with real output — don't claim green without showing it.

Start by proposing the tooling choices and the test file layout, get the Postgres-for-tests approach decided, then implement unit tests first and iterate outward.
