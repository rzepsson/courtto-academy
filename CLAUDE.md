# CLAUDE.md

Guidance for AI agents and developers working in this repo. Keep it accurate — update it when an architectural decision changes.

## What this is

**courtto academy** — multi-tenant B2B SaaS for tennis & padel schools. Each school is a tenant, modeled as a Better Auth **organization**.

**Stack:** Nuxt 4 · Nuxt UI 4 (Tailwind v4) · Drizzle ORM (PostgreSQL, postgres-js) · Better Auth (`organization` plugin) · @nuxtjs/i18n (en/pl) · motion-v (animations). Package manager: **pnpm**.

## Layout (Nuxt 4)

`srcDir` is `app/` — pages, components, composables, layouts, `app.config.ts`, `app.vue` live there. Auth screens use `layouts/auth.vue` (a single centered column: brand mark above the form card, locale/theme switch top-right, no side panel). Login/register pages use a subtle staggered `MotionReveal` entrance on their content (title, form, footer link) for a more polished feel — kept short (`y="8"`, ~0.08s stagger) so it doesn't read as sluggish. **Page/layout transitions are disabled** (`app.pageTransition: false` in `nuxt.config.ts`): `mode: 'out-in'` drops the incoming page's content whenever the target has async `setup` (Suspense), which every dashboard page does, so client-side nav rendered a blank panel until refresh. The app shell is `layouts/dashboard.vue` (Nuxt UI `UDashboardGroup` sidebar + user menu). Brand assets: `components/AppLogo.vue` (SVG mark) and `components/BrandMark.vue` (lockup, `horizontal` prop for the sidebar). The Nitro `server/` dir is at the **project root**.

```
app/            pages, components, composables, app.config.ts, app.vue, assets/css
server/
  api/          HTTP handlers — thin, call services only
  utils/        auto-imported: db.ts, auth.ts, org.ts, session.ts, services/*
  database/     schema.ts (generated), types.ts (hand-written)
shared/         permissions.ts — org roles + access control, imported by BOTH
                server/utils/auth.ts and app/utils/auth-client.ts
i18n/locales/   en.json, pl.json
```

## Non-negotiable rules

1. **Services pattern.** All Drizzle queries live in `server/utils/services/*`. API handlers in `server/api/*` only call services — never import `db` or write queries in a handler.
2. **DB & auth are plain module-level singletons** (no factories, no `useRuntimeConfig`): `export const db` / `export const auth`, reading env via `import { env } from 'node:process'`. Better Auth auto-reads `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` from env — don't pass them in config.
3. **`server/database/schema.ts` is GENERATED — do not hand-edit it.** Run `pnpm auth:generate` (the `auth` CLI + an eslint --fix pass). It emits the auth/org tables with FK indexes, `$onUpdate`, and drizzle `relations()`. Hand-written convenience types go in `server/database/types.ts`.
4. **Better Auth owns its tables.** `organization` etc. have `id`/`createdAt` as notNull with no DB default — Better Auth populates them. So services over these tables are **read-only**; create/update/delete go through Better Auth's API, never a direct Drizzle insert.
5. **i18n — no hardcoded UI text.** Use `const { t } = useI18n()`; messages in `i18n/locales/*.json` (strategy `no_prefix`). Brand wordmark ("Courtto" / "Academy") in `app/components/BrandMark.vue` is the one deliberate exception.
6. **Nuxt UI theming.** Brand color is vibrant neon/emerald green: `ui.colors.primary: 'green'` in `app/app.config.ts` + the `--color-green-*` ramp in `app/assets/css/main.css`. Don't restyle Nuxt UI components with inline Tailwind at the call site — change `app.config.ts` instead.
7. **Comments are minimal.** This repo may go public. Don't comment self-evident code; comment only genuinely non-obvious decisions.

## Conventions

- **Env vars (plain, no `NUXT_` prefix):** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. `drizzle.config.ts` reads `process.env.DATABASE_URL`.
- **Drizzle adapter:** the built-in `better-auth/adapters/drizzle` (version-matched to core), not the standalone `@better-auth/drizzle-adapter`.
- **Performance:** `experimental: { joins: true }` is enabled in `auth.ts` (2–3× faster `get-session`/`get-full-organization`); it relies on `import * as schema` (with relations) being passed to both `drizzle()` and `drizzleAdapter()`.
- **Animations:** `motion-v` via the `motion-v/nuxt` module (`Motion`, `MotionConfig`, … are auto-registered). A global `<MotionConfig reduced-motion="user">` wraps the app in `app.vue`, so all motion honors the OS reduced-motion setting. Two tiers:
  - **Micro-interactions everywhere** — press/hover springs on buttons (`components/PressButton.vue`), hover lifts on cards/tiles.
  - **Entrance animations** via `components/MotionReveal.vue` (fade + rise; `delay` prop staggers siblings) — used on dashboard (client area) content, and, subtly (`y="8"`, ~0.08s stagger between sections), on the login/register forms (`app/pages/login.vue`, `register.vue`) for a more polished first impression. No page/layout transitions (disabled in `nuxt.config.ts`); use `<NuxtLoadingIndicator>` (in `app.vue`) for route-change feedback and `MotionReveal` for content.
  - **Loading:** data-heavy pages fetch with `useLazyFetch` and render `USkeleton`/`components/AppListSkeleton.vue` while `status === 'pending'`, so navigation is instant and content streams in.
- **Fonts:** `@nuxt/fonts` self-hosts Public Sans, picked up from `--font-sans` in `app/assets/css/main.css`. `html` has `scrollbar-gutter: stable` so appearing/disappearing scrollbars don't shift the layout.
- **Client data fetching:** components/composables use `useFetch`/`useAsyncData` against internal `/api/*` routes — never call the server layer directly (e.g. `app/composables/useOrganizations.ts`).

## Auth & sessions

- **Client actions:** one Better Auth client singleton in `app/utils/auth-client.ts` (`createAuthClient` from `better-auth/vue`, same-origin — no `baseURL`). Sign in/up/out call `authClient.*` directly from pages.
- **Reading the session:** `app/composables/useAuthSession.ts` exposes `useAuthSession()` = `useFetch('/api/session')` (SSR-safe, cookies auto-forwarded) and `refreshAuthSession()`. `/api/session` (`server/api/session.get.ts`) returns `{ session }` (nullable inside — a bare `null` body would become an empty response and trigger useFetch's undefined-value warning); the composable unwraps it via `transform`. This is the single source of session truth — don't read sessions any other way on the client.
  - **Do NOT use `authClient.useSession(useFetch)`** — it passes a `{ ref }` option Nuxt's `useFetch` ignores, so the cache never invalidates after sign-in/out (stale session → broken redirects).
  - **After every auth transition** (`signIn`/`signUp`/`signOut`) call `await refreshAuthSession()` **before** `navigateTo`, or middleware reads the stale cached session. Also call `clearAppContext()` (from `useAppContext`) on these transitions — the `app:context` cache is keyed globally, not per-user, so without clearing it the previous user's memberships/roles leak into the next session in the same tab.
- **Route protection:** named middleware `app/middleware/auth.ts` (require session → `/login`) and `guest.ts` (redirect authed → `/dashboard`), applied per-page via `definePageMeta({ middleware: ... })`.
- **Server-side route protection:** `server/utils/session.ts` exports `getUserSession(event)` (nullable) and `requireUserSession(event)` (throws 401). Custom API handlers needing auth call `requireUserSession` first (template: `server/api/me.get.ts`).
- **Email verification is OFF for now** (no mail provider yet) — sign-up logs the user straight in.
- **DB migrations:** schema changes (re-run `pnpm auth:generate` when auth tables change) are applied via `pnpm db:generate` (emit SQL to `server/database/migrations/`) then `pnpm db:migrate`. Use migrations, not `db:push`.

## Organizations, roles & invitations

- **Roles** (per membership, single role): `owner`, `admin`, `coach`, `student`, `parent` — defined once in `shared/permissions.ts` (`ac` + `roles`, wired into both the `organization()` plugin and `organizationClient()`). `INVITABLE_ROLES` excludes `owner`. Role labels/colors render via `app/components/RoleBadge.vue`.
- **Role-based routing:** `/dashboard` never renders — middleware `resolve-home` redirects to the active-org role's home: owner/admin → `/school`, coach → `/coach`, student/parent → `/my`; no membership → `/onboarding`. The mapping lives in `roleHome()` (`app/utils/org.ts`). Area pages use middleware chains `['auth', 'school'|'coach'|'my-area']` built on `resolveAreaRedirect()` (`app/utils/area-guard.ts`).
- **Active organization:** `session.activeOrganizationId`, seeded by a `databaseHooks.session.create.before` hook (first membership) and switched via `authClient.organization.setActive` (see `useOrgSwitch()`). `GET /api/app-context` (composable `useAppContext()` / `refreshAppContext()`) returns memberships + a **validated** active org id — the single client source of org/role truth.
- **Server-side org guard:** `requireActiveMembership(event, allowedRoles?)` in `server/utils/org.ts` — custom `/api/school/*` handlers call it first.
- **Invitations are copyable links** (no mail provider): owner/admin creates one via `authClient.organization.inviteMember` (7-day expiry) and shares `/invite/[id]`. The landing endpoint `GET /api/invitations/[id]` is public by design (the id is the unguessable token; the email is masked server-side). Accept/reject go through `authClient.organization.*`; Better Auth enforces that the signed-in user's email matches the invitation.
- **Reads vs mutations:** reads via services + `/api/*` (`membership.ts` service), all org/member/invitation mutations via `authClient.organization.*` — never Drizzle writes (rule 4).
- **Gotcha — Nuxt async context:** the unctx transform covers `app/middleware/*` and plugins only. Never call `navigateTo` (or other Nuxt composables) after an `await` inside `app/utils/*` — compute the redirect target in the util, call `navigateTo` from the middleware file.
- **Gotcha — `auth` CLI:** `server/utils/auth.ts` and everything it imports (e.g. `services/membership.ts`, `shared/permissions.ts`) is loaded by the `auth` CLI **outside Nuxt** — those files need explicit imports (no auto-imports, no Nuxt aliases).

## Testing

Three tiers (full guide in `TESTING.md`). **Vitest** for unit + server, **Playwright** for e2e. Tests live under `test/{unit,server,e2e}/`; config in `vitest.config.ts` (two projects: `unit`, `server`) and `playwright.config.ts`.

```bash
pnpm test          # unit — pure functions, no DB, always runnable
pnpm test:watch    # unit in watch mode
pnpm test:server   # server integration — needs TEST_DATABASE_URL (else skips)
pnpm test:e2e      # Playwright — needs .env.e2e + E2E_DATABASE_URL, served on :3000
```

- **Unit** covers the security-critical pure logic in `shared/permissions.ts`, `app/utils/{org,format}.ts`, and the exported `maskEmail`/`toOrgRole` helpers.
- **Server** exercises `requireActiveMembership`, the `membership.ts` service (expiry filter, multi-tenant isolation) and invitation masking against a real Postgres. It seeds **only** through `auth.api.*` (rule 4); the one test-only DB write is `expireInvitation()`. Gated on `TEST_DATABASE_URL` — **never** falls back to the dev `DATABASE_URL`; unset → the suite skips (green).
- **E2E** drives signup/onboarding, per-role home routing, permission denial (401/403), and the cross-user cache-isolation regression. The app is served on **port 3000** (Better Auth origin check) via `--dotenv .env.e2e`, isolating it from the dev DB. Local-only, not in CI.
- CI (`.github/workflows/ci.yml`) runs lint → typecheck → unit → server (with a Postgres service) → build.

## Quality gates (must pass before done)

```bash
pnpm typecheck   # nuxt typecheck (vue-tsc)
pnpm lint        # eslint
pnpm test        # vitest unit tier (add test:server when a test DB is available)
```

## Known gotchas

- **Nuxt UI v4 renamed `UButtonGroup` → `UFieldGroup`** (groups buttons + inputs). The old name fails silently at runtime.
- `node:` builtins need `@types/node` (installed) to typecheck.

