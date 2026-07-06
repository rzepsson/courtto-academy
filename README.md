# courtto academy

Multi-tenant B2B SaaS for tennis & padel schools. Each school is a tenant (Better Auth organization).

**Stack:** Nuxt 4 · Nuxt UI 4 · Drizzle ORM (PostgreSQL) · Better Auth · @nuxtjs/i18n (en/pl)

## Setup

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL and BETTER_AUTH_SECRET
pnpm db:push           # apply the schema to your database
pnpm dev               # http://localhost:3000
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` / `build` / `preview` | Nuxt dev server / production build / preview |
| `pnpm lint` / `typecheck` | ESLint / `vue-tsc` |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle Kit |
| `pnpm auth:generate` | Regenerate `server/database/schema.ts` from the Better Auth config |

## Architecture

- **Services pattern** — all Drizzle queries live in `server/utils/services/*`. API handlers in `server/api/*` only call services.
- **Auth** — `server/utils/auth.ts` exports the Better Auth instance; mounted at `server/api/auth/[...all].ts`. Auth/org tables in `server/database/schema.ts` are generated via `pnpm auth:generate` (don't hand-edit); convenience types live in `server/database/types.ts`.
- **i18n** — locale messages in `i18n/locales/*.json`; no hardcoded UI text.
