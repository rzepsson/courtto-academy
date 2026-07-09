# CLAUDE.md

Guidance for AI agents and developers working in this repo. Keep it accurate — update it when an architectural decision changes.

## What this is

**courtto academy** — multi-tenant B2B SaaS for tennis & padel schools. Each school is a tenant, modeled as a Better Auth **organization**.

**Stack:** Nuxt 4 · Nuxt UI 4 (Tailwind v4) · Drizzle ORM (PostgreSQL, postgres-js) · Better Auth (`organization` plugin) · @nuxtjs/i18n (en/pl) · motion-v (animations). Package manager: **pnpm**.

## Product vision & future architecture

Two products are planned on **one shared backend + database**:

- **Courtto Academy** (this app) — B2B SaaS for managing racket-sport **schools**. Every user here is a **tenant member** (belongs to a specific org): owner/admin run the school, coaches teach, students have their own in-tenant panel (`/my`). This is *not* a public marketplace — a student is a member of one school, not an anonymous consumer.
- **Courtto** (future, separate) — a public court-**booking marketplace** ("Booksy for courts"): players discover and book courts. Different audience, SEO/public traffic, mostly anonymous/light accounts, different scaling & branding.

**The split is consumer-vs-admin, not product-vs-product.** Planned shape (industry-standard: Booksy + Booksy Biz, Playtomic + Playtomic Manager):

- **Consumer Courtto = its own app** (separate frontend/deploy/domain) — a public marketplace shouldn't share a frontend with an authed dashboard.
- **Admin/provider panel = one shared app** (this one grows). An org is a `school`, a `facility`, or **both**; areas are **capability-gated** by the org's `types` (see the type/status model discussed for `orgProfile`: `types[]` capabilities, org-wide `active`/`suspended` status, and per-facility verification — orthogonal axes, never one enum). A single owner running a school *and* renting courts logs into one panel.
- **Shared core** = DB, `server/services`, `shared/permissions`, schema, auth, org/members/notifications/settings. This is the most valuable asset and what makes the expansion cheap.

**Active soft rule until then (no restructuring now — build Academy to completion first):** keep the generic core product-neutral. `org`, `members`, `roles`, `notifications`, `auth`, `settings/profile` are shared plumbing — do **not** weave Academy-specific concepts (lessons, coaches, students-as-domain) into them. Academy-domain logic lives in its own services/areas on top of that core. Then extracting the core to `packages/core` (pnpm workspaces) when Courtto starts is moving files, not rewriting. **Flag it** when Academy-specifics start leaking into the generic core.

## Layout (Nuxt 4)

`srcDir` is `app/` — pages, components, composables, layouts, `app.config.ts`, `app.vue` live there. Auth screens use `layouts/auth.vue` (a single centered column: brand mark above the form card, locale/theme switch top-right, no side panel). Login/register pages use a subtle staggered `MotionReveal` entrance on their content (title, form, footer link) for a more polished feel — kept short (`y="8"`, ~0.08s stagger) so it doesn't read as sluggish. **Page/layout transitions are disabled** (`app.pageTransition: false` in `nuxt.config.ts`): `mode: 'out-in'` drops the incoming page's content whenever the target has async `setup` (Suspense), which every dashboard page does, so client-side nav rendered a blank panel until refresh. The app shell is `layouts/dashboard.vue` (Nuxt UI `UDashboardGroup` sidebar + user menu). Brand assets: `components/AppLogo.vue` (SVG mark) and `components/BrandMark.vue` (lockup, `horizontal` prop for the sidebar). The Nitro `server/` dir is at the **project root**.

```
app/            pages, components, composables, app.config.ts, app.vue, assets/css
server/
  api/          HTTP handlers — thin, call services only
  utils/        auto-imported: db.ts, auth.ts, org.ts, session.ts, services/*
  database/     schema.ts (generated), app-schema.ts (hand-written app tables),
                types.ts (hand-written)
shared/         permissions.ts — org roles + access control, imported by BOTH
                server/utils/auth.ts and app/utils/auth-client.ts
i18n/locales/   en.json, pl.json
```

## Non-negotiable rules

1. **Services pattern.** All Drizzle queries live in `server/utils/services/*`. API handlers in `server/api/*` only call services — never import `db` or write queries in a handler.
2. **DB & auth are plain module-level singletons** (no factories, no `useRuntimeConfig`): `export const db` / `export const auth`, reading env via `import { env } from 'node:process'`. Better Auth auto-reads `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` from env — don't pass them in config.
3. **`server/database/schema.ts` is GENERATED — do not hand-edit it.** Run `pnpm auth:generate` (the `auth` CLI + an eslint --fix pass). It emits the auth/org tables with FK indexes, `$onUpdate`, and drizzle `relations()`. Hand-written convenience types go in `server/database/types.ts`. **App-owned tables** (not Better Auth's) go in `server/database/app-schema.ts` — that file survives regeneration; both are merged in `db.ts` (`{ ...schema, ...appSchema }`) and both are listed in `drizzle.config.ts`.
4. **Better Auth owns its tables.** `organization` etc. have `id`/`createdAt` as notNull with no DB default — Better Auth populates them. So services over these tables are **read-only**; create/update/delete go through Better Auth's API (e.g. `auth.api.addMember` for programmatic membership), never a direct Drizzle insert. This rule is scoped to Better-Auth-owned tables; services write to **app-owned** tables (`app-schema.ts`, e.g. `orgJoinCode`) with Drizzle directly.
5. **i18n — no hardcoded UI text.** Use `const { t } = useI18n()`; messages in `i18n/locales/*.json` (strategy `no_prefix`). Brand wordmark ("Courtto" / "Academy") in `app/components/BrandMark.vue` is the one deliberate exception. **Error messages are localized too** — never surface a raw `error.message` from Better Auth or a server response to the user (it's untranslated English). Failures carry a stable code (`error.code`, or `data.code` on a Nitro `createError`); the `useApiError()` composable (`resolve`/`toastError`) maps it to `error.codes.<CODE>` in the locale files, falling back to generic localized copy for unknown codes / rate limits / network errors. The key-selection policy is the pure, unit-tested `resolveErrorKey`/`normalizeError` in `app/utils/errors.ts`. Codes come from Better Auth's `BASE_ERROR_CODES` (core) and `ORGANIZATION_ERROR_CODES` (org plugin) — e.g. a taken slug is `ORGANIZATION_ALREADY_EXISTS` (create) / `ORGANIZATION_SLUG_ALREADY_TAKEN` (update), **not** `SLUG_IS_TAKEN`.
6. **Nuxt UI theming.** Brand color is vibrant neon/emerald green: `ui.colors.primary: 'green'` in `app/app.config.ts` + the `--color-green-*` ramp in `app/assets/css/main.css`. Don't restyle Nuxt UI components with inline Tailwind at the call site — change `app.config.ts` instead.
7. **Comments are minimal.** This repo may go public. Don't comment self-evident code; comment only genuinely non-obvious decisions.

## Conventions

- **Env vars (plain, no `NUXT_` prefix):** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. `drizzle.config.ts` reads `process.env.DATABASE_URL`. **Object storage (optional)** for logo uploads: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`, `S3_FORCE_PATH_STYLE` — read lazily in `server/utils/storage.ts` (S3-compatible: R2/S3/MinIO). Unset → uploads return 503 and the settings UI degrades; nothing else breaks.
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

- **Roles** (per membership, single role): `owner`, `admin`, `coach`, `student` — defined once in `shared/permissions.ts` (`ac` + `roles`, wired into both the `organization()` plugin and `organizationClient()`). `INVITABLE_ROLES` excludes `owner`. Role labels/colors render via `app/components/RoleBadge.vue`. (A former `parent` role was merged into `student`; `toOrgRole()` coerces the legacy value, so no data migration was needed.)
- **Role-based routing:** `/dashboard` never renders — middleware `resolve-home` redirects to the active-org role's home: owner/admin → `/school`, coach → `/coach`, student → `/my`; no membership → `/onboarding`. The mapping lives in `roleHome()` (`app/utils/org.ts`). Area pages use middleware chains `['auth', 'school'|'coach'|'my-area']` built on `resolveAreaRedirect()` (`app/utils/area-guard.ts`).
- **Active organization:** `session.activeOrganizationId`, seeded by a `databaseHooks.session.create.before` hook (first membership) and switched via `authClient.organization.setActive` (see `useOrgSwitch()`). `GET /api/app-context` (composable `useAppContext()` / `refreshAppContext()`) returns memberships + a **validated** active org id — the single client source of org/role truth.
- **Server-side org guard:** `requireActiveMembership(event, allowedRoles?)` in `server/utils/org.ts` — custom `/api/school/*` handlers call it first.
- **Two ways to join a school:**
  - **Personal email invitations** — for staff (admin/coach) and any role-specific add. Owner/admin creates one via `authClient.organization.inviteMember` (7-day expiry) and shares `/invite/[id]`. The landing endpoint `GET /api/invitations/[id]` is public by design (the id is the unguessable token; the email is masked server-side). Accept/reject go through `authClient.organization.*`; Better Auth enforces that the signed-in user's email matches the invitation.
  - **Self-service join code** — for students (bulk, no email). One rotatable code per org (`orgJoinCode` in `app-schema.ts`; PK = organizationId), TTL 14 days, always grants `student` (never a privileged role). An `enabled` flag pauses self-enrollment without discarding the code (toggle off → preview + join 404, code preserved for when it's switched back on; rotating re-enables). Managed at `/api/school/join-code` (GET current / POST rotate / PATCH `{enabled}`, school roles only); redeemed via public `GET /api/join/[code]` (preview) + `POST /api/join` (adds membership through `auth.api.addMember`, idempotent). Client pages: `/join` (code input) and `/join/[code]` (preview + confirm). Service: `server/utils/services/joinCode.ts` (unambiguous 8-char alphabet, no 0/O/1/I).
- **Extended school profile** — the Better Auth `organization` table only models `name`/`slug`/`logo`/`metadata`. Everything else a school fills in (contact, address, timezone/locale/currency, legal name + tax id, offered sports, description) lives in the app-owned **`orgProfile`** table (`app-schema.ts`; PK = organizationId, 1:1). Kept out of the auth table on purpose: it's app-domain data, must not bloat get-session/app-context payloads, and grows without re-running `pnpm auth:generate`. Read/written by `services/orgProfile.ts` (Drizzle directly — app-owned) via `GET`/`PATCH /api/school/profile` (school roles); each settings section PATCHes only its own keys. **Validation is one shared Zod schema** (`shared/org-profile-schema.ts`) — the single source of truth for the profile's rules: the server parses the PATCH body against it (`normalizeOrgProfilePatch` via `readValidatedBody`, `.partial()` so only present keys survive) **and** each settings card binds its section slice to `UForm :schema` (`profileSectionSchemas` in `app/utils/orgProfile.ts`), so form and API can never drift. The schema is parameterized by a **message resolver** (client → localized i18n error keys, server → raw stable codes that are never user-facing — server validation is defense-in-depth behind the form); section grouping (`PROFILE_SECTION_FIELDS`) and the flat form-state shape (`ProfileFormState`) derive from it too. Constants + pure format helpers (sports, locales, email/url/phone checks) stay in `shared/org-profile.ts`. **Deliberately added later in settings, not at onboarding** (better UX; a future notification system integrates with timezone/locale/contactEmail) — with one exception: the **operational regional defaults** (`country`/`timezone`/`currency`/`locale`) are silently **seeded at school creation** from zero-permission browser signals (`Intl…timeZone` + `navigator.language`), so a school doesn't start as Poland regardless of location. The derivation is the pure, unit-tested `deriveRegionalDefaults` in `shared/regional.ts` (curated timezone→country + country→currency tables, degrading field-by-field to `REGIONAL_FALLBACK`, which is also the server-side `PROFILE_DEFAULTS`). Onboarding computes it client-side (`app/utils/regional.ts` `detectBrowserRegional`) and best-effort-PATCHes `/api/school/profile` after create — a failure just leaves the server defaults. No modal, no GPS; the UI language itself is separately handled by i18n `detectBrowserLanguage`. `name`/`slug`/`logo` still mutate through Better Auth (`authClient.organization.update`). **Logo uploads** go to S3-compatible storage: `POST /api/school/logo` (multipart, ≤2 MB, png/jpeg/webp) returns a URL the client then persists as `logo` via `organization.update`.
- **Reads vs mutations:** reads via services + `/api/*` (`membership.ts` service). Better Auth org/member/invitation mutations go via `authClient.organization.*` (client) or `auth.api.*` (server) — never direct Drizzle writes to those tables (rule 4). App-owned tables like `orgJoinCode` and `orgProfile` are written by their service directly.
- **Gotcha — Nuxt async context:** the unctx transform covers `app/middleware/*` and plugins only. Never call `navigateTo` (or other Nuxt composables) after an `await` inside `app/utils/*` — compute the redirect target in the util, call `navigateTo` from the middleware file.
- **Gotcha — `auth` CLI:** `server/utils/auth.ts` and everything it imports (e.g. `services/membership.ts`, `shared/permissions.ts`, `services/notifications.ts`) is loaded by the `auth` CLI **outside Nuxt** — those files need explicit imports (no auto-imports, no Nuxt aliases).

## Courts (facility core)

A facility's courts/tables, managed at `/school/courts` (school roles). **This is facility-core, NOT Academy** — deliberately product-neutral so the future Courtto marketplace books the *same* rows: nothing here references lessons/coaches/students. When the core is extracted to `packages/core`, courts move with it.

- **Model — app-owned `court`** (`app-schema.ts`; FK → organization, cascade). Axes kept **orthogonal** (never one enum): `status` = operational (`active`/`maintenance`), `archivedAt` = lifecycle (**soft-delete**, so schedule/booking history never orphans). Name is **case-insensitively unique among active courts** (partial unique index `WHERE archived_at IS NULL`, so archiving frees the name). `sortOrder` drives display order (drag-reorder). `bookable` is a **seam** for Courtto (unused today, no UI). `zone` is lightweight grouping (no `courtZone` table yet). Written by `services/courts.ts` with Drizzle directly — **every query scoped by `organizationId`, never id alone** (multi-tenant isolation, covered by server tests).
- **Discipline is validated ⊂ `orgProfile.sports`** on write (defense-in-depth; the builder only offers declared sports). A court's **white-line pattern is derived from `sport`, never stored** — only surface/line colours are per-court.
- **Shared domain — `shared/courts.ts`** (pure, no Nuxt/Node; imported by server validation + client form + the SVG renderer): `COURT_SPECS` (per-discipline geometry in metres — the line pattern), unit (`court`/`table`), `SURFACES_BY_SPORT`, colour presets/defaults, and the low-level validators. Unit-tested (`test/unit/courts.test.ts`); server-tested against Postgres (`test/server/courts-service.test.ts`: tenant isolation, sport-not-offered, name uniqueness, surface-drop-on-sport-change, reorder, hard-delete).
- **Validation is one shared Zod schema** (`shared/courts-schema.ts`, mirroring `org-profile-schema.ts`): the builder binds it to `UForm :schema` and the server parses the POST/PATCH body against the same rules (`courtCreateSchema` full / `courtPatchSchema` partial), so form and API can't drift. Parameterized by a message resolver (client → localized keys, server → raw codes). Two **context-dependent** rules stay in the service, not the static schema: the discipline must be ⊂ `orgProfile.sports`, and the surface must be valid for the *effective* sport (which, on a partial update, may be the stored one).
- **Lifecycle — archive vs delete.** `DELETE [id]` **archives** (soft — `archivedAt`, reversible, keeps history); `DELETE [id]?purge=1` **hard-deletes** (`deleteCourt`, irreversible, will cascade to future schedule/booking/group FKs — UI guards it with a warning); `PATCH [id] {restore:true}` restores. Archived courts **stay visible** in the roster (dimmed, in their own "Archived" section), never hidden.
- **REST** `server/api/school/courts/*`: `GET` (`?includeArchived=1`), `POST`, `GET/PATCH/DELETE [id]`, `PATCH reorder`. The static `reorder` route wins over `[id]` in Nitro; on the client, typed `$fetch` intersects a dynamic `/courts/${id}` path with the sibling `reorder` route, so a `DELETE` there needs the URL annotated `: string` to widen the method type.
- **Visual builder** — `components/courts/Diagram.vue` (`<CourtsDiagram>`) is the product-neutral top-down SVG (surface fill + white lines + walls for enclosed disciplines), reused in the roster tile (`<CourtsCard>`) and the two-pane `<SchoolCourtsFormSlideover>` (form ⟷ live preview). Client dates arrive serialized, so the UI binds against `CourtView` (string dates), not the server `CourtDto` (`Date`).

## Notifications & realtime

Per-user notification inbox surfaced as the bell in the dashboard navbar (`components/AppHeaderControls.vue` bundles `NotificationBell` + locale + theme; every area page's `#right` slot renders that one component). Sorted newest-first.

- **Model — per-user rows, optionally org-tagged.** App-owned `notification` table (`app-schema.ts`): each row is one recipient's copy with its **own** `readAt`/dismissed state (never shared across users). `organizationId` (nullable, cascade) tags the school context; the bell scopes to **active org + account-level (org-less)** items so a multi-school user never sees two schools' contexts mixed. `type` (stable machine key) + JSON `data` only — **never store localized text** (rule 5); the client renders `notifications.types.<type>.{title,body}` with `data` interpolated, falling back to `notifications.fallback.*` for unknown types. `link` deep-links the bell.
- **Read state** = "seen in the bell". Opening the popover marks the whole scope read (`POST /api/notifications/read`), clearing the `UChip` unread badge.
- **Dismissible vs system-managed.** `dismissible` (default true) rows get an `x` and are wiped by "clear all". **System notifications** (`SYSTEM_NOTIFICATION_TYPES` in `shared/notifications.ts`) are `dismissible: false`: no `x`, skipped by clear-all, and **resolved by a condition, not a click** — the system owns their lifecycle. They carry a `dedupeKey` (partial-unique with `userId`) so they're created at most once. There is deliberately **one** such type today.
- **First notification — `org.setup_incomplete`.** Emitted to the owner from Better Auth's `organizationCreation.afterCreate` hook (`auth.ts`, best-effort — never fails org creation). Resolved (deleted for the whole org) the moment the profile becomes complete, in `POST /api/school/profile`.
- **Org readiness is derived, not stored.** `computeProfileCompletion(profile)` in `shared/org-profile.ts` (pure, unit-tested) is the single source of truth — a stored boolean would drift. Required-to-operate fields: `REQUIRED_PROFILE_FIELDS` = `contactEmail`, `sports` (≥1), `city`, `country` (operational fields like timezone/locale/currency carry safe defaults, so they never block). This gates the setup notification **and** drives the readiness checklist at the top of `/school/settings` (`components/school/SetupChecklist.vue`, computed from the persisted `baseline` so it resolves in step with the notification — both on save, never on unsaved edits; each item deep-links to its settings section).
- **Service** `services/notifications.ts` (Drizzle directly — app-owned; explicit imports, reachable from the `auth` CLI): `createNotification` (dedupes via `onConflictDoNothing`), `getNotificationFeed`, `markScopeRead`, `dismissNotification` (guarded to owner + dismissible), `clearNotifications`, plus the `org.setup_incomplete` emit/resolve pair. REST: `GET /api/notifications` (feed + unread count), `POST /api/notifications/read`, `DELETE /api/notifications/[id]`, `DELETE /api/notifications` (clear all). All scope via `getActiveScope(event)` (`org.ts`).
- **Realtime — Nitro built-in WebSocket (crossws).** Enabled by `nitro.experimental.websocket` in `nuxt.config.ts`. Handler `server/api/notifications/ws.ts` (`defineWebSocketHandler`) authenticates the peer once from its session cookie (`auth.api.getSession`) and registers it by user id in an **in-process** singleton (`server/utils/realtime.ts`, `publishToUser`). `createNotification` nudges the user's peers; the client (`plugins/notifications.client.ts`) reconnects with backoff and just calls `refreshNotifications()` on any message. **Realtime is an enhancement, never the source of truth** — the REST feed is authoritative, so a dropped socket degrades to fetch-on-load and self-heals. Known limit: the registry is per-process; horizontal scaling needs a Redis / Postgres LISTEN-NOTIFY fan-out behind `publishToUser` (the single seam).
- **Client** `composables/useNotifications.ts` (keyed `useFetch`, optimistic mutate + reconcile) is the single client source; `clearNotificationsCache()` runs on every auth transition (`useSignOut`) so the previous user's notifications don't leak into the next session in the same tab (mirrors `clearAppContext`).

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

