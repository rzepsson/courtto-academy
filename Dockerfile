# syntax=docker/dockerfile:1

# Production image for Courtto Academy. Built by Coolify from the repository.
#
# Deployment constraints this image encodes (see CLAUDE.md for why):
#   - SINGLE INSTANCE ONLY. The realtime WebSocket peer registry is in-process and
#     the scheduled sweeps have no cross-instance lock, so replicas > 1 would drop
#     notifications and double-run the nightly jobs.
#   - The container must stay running. The lesson-reminder and materialization
#     sweeps are Nitro scheduled tasks inside this process, not external cron.
#   - Migrations run on start, before the server. Safe because of the constraint
#     above, and idempotent regardless (Drizzle's journal skips applied files).

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# The whole source is needed before install: `postinstall` runs `nuxt prepare`,
# which reads the app to generate .nuxt types.
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Nitro's node-server output is self-contained: `.output/server/node_modules`
# holds every traced runtime dependency, so there is no second `pnpm install`.
COPY --from=builder --chown=node:node /app/.output ./.output

# Placed INSIDE .output/server so the migrator resolves `drizzle-orm` and
# `postgres` from the traced node_modules beside it.
COPY --from=builder --chown=node:node /app/server/database/migrations ./.output/server/migrations
COPY --from=builder --chown=node:node /app/scripts/migrate.mjs ./.output/server/migrate.mjs

USER node
EXPOSE 3000

# /api/health is the readiness probe: a single `SELECT 1`, 200 when the database
# is reachable and 503 when it is not (server/utils/services/health.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

# Chained on success: a failed migration must stop the app from starting against a
# half-migrated schema rather than serving errors.
CMD ["sh", "-c", "node .output/server/migrate.mjs && exec node .output/server/index.mjs"]
