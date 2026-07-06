# CLAUDE.md

Guidance for AI agents and developers working in this repo. Keep it accurate — update it when an architectural decision changes.

## What this is

**courtto academy** — multi-tenant B2B SaaS for tennis & padel schools. Each school is a tenant, modeled as a Better Auth **organization**.

**Stack:** Nuxt 4 · Nuxt UI 4 (Tailwind v4) · Drizzle ORM (PostgreSQL, postgres-js) · Better Auth (`organization` plugin) · @nuxtjs/i18n (en/pl). Package manager: **pnpm**.

## Layout (Nuxt 4)

`srcDir` is `app/` — pages, components, composables, layouts, `app.config.ts`, `app.vue` live there. Auth screens use `layouts/auth.vue` (brand mark + centered card + locale switcher). The Nitro `server/` dir is at the **project root**.

```
app/            pages, components, composables, app.config.ts, app.vue, assets/css
server/
  api/          HTTP handlers — thin, call services only
  utils/        auto-imported: db.ts, auth.ts, services/*
  database/     schema.ts (generated), types.ts (hand-written)
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
- **Client data fetching:** components/composables use `useFetch`/`useAsyncData` against internal `/api/*` routes — never call the server layer directly (e.g. `app/composables/useOrganizations.ts`).

## Auth & sessions

- **Client actions:** one Better Auth client singleton in `app/utils/auth-client.ts` (`createAuthClient` from `better-auth/vue`, same-origin — no `baseURL`). Sign in/up/out call `authClient.*` directly from pages.
- **Reading the session:** `app/composables/useAuthSession.ts` exposes `useAuthSession()` = `useFetch('/api/session')` (SSR-safe, cookies auto-forwarded) and `refreshAuthSession()`. `/api/session` (`server/api/session.get.ts`) returns `{ session }` (nullable inside — a bare `null` body would become an empty response and trigger useFetch's undefined-value warning); the composable unwraps it via `transform`. This is the single source of session truth — don't read sessions any other way on the client.
  - **Do NOT use `authClient.useSession(useFetch)`** — it passes a `{ ref }` option Nuxt's `useFetch` ignores, so the cache never invalidates after sign-in/out (stale session → broken redirects).
  - **After every auth transition** (`signIn`/`signUp`/`signOut`) call `await refreshAuthSession()` **before** `navigateTo`, or middleware reads the stale cached session.
- **Route protection:** named middleware `app/middleware/auth.ts` (require session → `/login`) and `guest.ts` (redirect authed → `/dashboard`), applied per-page via `definePageMeta({ middleware: ... })`.
- **Server-side route protection:** `server/utils/session.ts` exports `getUserSession(event)` (nullable) and `requireUserSession(event)` (throws 401). Custom API handlers needing auth call `requireUserSession` first (template: `server/api/me.get.ts`).
- **Email verification is OFF for now** (no mail provider yet) — sign-up logs the user straight in.
- **DB migrations:** schema changes (re-run `pnpm auth:generate` when auth tables change) are applied via `pnpm db:generate` (emit SQL to `server/database/migrations/`) then `pnpm db:migrate`. Use migrations, not `db:push`.

## Quality gates (must pass before done)

```bash
pnpm typecheck   # nuxt typecheck (vue-tsc)
pnpm lint        # eslint
```

## Known gotchas

- **Nuxt UI v4 renamed `UButtonGroup` → `UFieldGroup`** (groups buttons + inputs). The old name fails silently at runtime.
- `node:` builtins need `@types/node` (installed) to typecheck.

