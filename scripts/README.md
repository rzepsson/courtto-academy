# scripts/

Standalone maintenance scripts. Run via `jiti` (Nuxt's loader — it handles the
CJS deps like `rrule` that raw `tsx`/node ESM chokes on). Excluded from the app
lint surface in `eslint.config.mjs`.

## `seed.ts` — demo data

Populates the database with two schools and realistic domain data so the app can
be exercised end-to-end **without any external service** (Stripe / S3 / SMTP are
all optional — the app degrades gracefully when unset). It seeds users/orgs/
members through `auth.api.*` and all app data through the real, tested services,
so every invariant (schedule conflicts, capacity, DST-correct occurrences, the
minor→guardian consent rule) is honoured.

It creates:

- **Akademia Tenisa Warszawa** (`warszawa-tenis`) — full profile, 9 members
  (owner/admin/2 coaches/5 students incl. 3 minors), 2 zones, 5 courts, recurring
  + one-off lessons with enrolments, guardians and consents. Deliberately seeds
  **compliance gaps** (a minor with no guardian; students never asked for image
  consent) so `/school/compliance` has something to show.
- **Padel Club Kraków** (`krakow-padel`) — a small second school, so multi-tenant
  isolation and school-switching are demonstrable.

**Every seeded account's password is `courtto123`.** The run prints a full
credentials table.

Idempotent per school: a school whose slug already exists is skipped, so
re-running is a safe no-op (reset the DB first if you want a fresh seed).

### Run locally (disposable Postgres)

```bash
# 1. Disposable Postgres (low port — Hyper-V reserves the 55xxx range on Windows)
docker run -d --name courtto-seed-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=courtto_seed \
  -p 5433:5432 postgres:16

export DATABASE_URL="postgres://postgres:postgres@localhost:5433/courtto_seed"
export BETTER_AUTH_SECRET="dev-seed-secret"   # any value locally

# 2. Apply migrations (creates the btree_gist extension + EXCLUDE constraints)
pnpm db:migrate

# 3. Seed
pnpm seed
```

Point the dev app at the same DB (`DATABASE_URL` in `.env`, dev server on
**port 3000**) and log in with any account above.

### Run against Supabase (production)

1. **Two connection strings.** Use the **Session/Direct** connection for
   migrations (`pnpm db:migrate`) and the **Transaction pooler** (port 6543) for
   the running app / the seed. Region **EU (Frankfurt)** for RODO data residency.
2. **`btree_gist`.** The schedule's race-safe conflict constraints need it. The
   migrations run `CREATE EXTENSION IF NOT EXISTS btree_gist`; the Supabase
   `postgres` role is allowed to, so `pnpm db:migrate` handles it. (If your
   migrating role is restricted, enable it once in Dashboard → Database →
   Extensions.)
3. Set `DATABASE_URL` + a strong `BETTER_AUTH_SECRET` (≥32 chars —
   `openssl rand -base64 32`), then `pnpm db:migrate && pnpm seed`.

> Seeding writes real rows to the target database. Point it at a fresh project
> (or one you're happy to fill with demo data) — there is no automatic teardown.

### Clean up the local container

```bash
docker rm -f courtto-seed-db
```
