---
name: verify
description: How to run and drive courtto-academy end-to-end for verification (dev server, curl auth flows, SSR redirect checks).
---

# Verifying courtto-academy

## Launch

A dev server is often already running (check the Nuxt dev lock error for the PID). `BETTER_AUTH_URL` in `.env` names the port — typically `http://localhost:3001`. If none is running: `pnpm dev` (needs `DATABASE_URL` pointing at a live Postgres; migrations via `pnpm db:migrate`).

## Drive it with curl

Better Auth POSTs require an `Origin: http://localhost:3001` header (CSRF check) and a cookie jar:

```bash
B=http://localhost:3001; O="-H Origin:$B"
curl -s -c u.jar $O -H 'Content-Type: application/json' \
  -d '{"name":"T","email":"t@test.local","password":"password123"}' $B/api/auth/sign-up/email
```

Key Better Auth org routes: `/api/auth/organization/{create,set-active,invite-member,accept-invitation,reject-invitation,cancel-invitation,update-member-role,remove-member,delete}`.

Custom API: `/api/app-context`, `/api/school/members`, `/api/school/invitations`, `/api/invitations/:id` (public landing).

## What to observe

- SSR role redirects: `curl -b u.jar -o /dev/null -w "%{http_code} -> %{redirect_url}" $B/dashboard` — expect 302 to `/onboarding` (no org), `/school` (owner/admin), `/coach`, or `/my`.
- Area guards: wrong-role user on `/school`/`/coach`/`/my` → 302 to their home; guest → `/login`.
- Permission failures surface as 401/403 JSON from `/api/auth/organization/*` and `/api/school/*`.

## Gotchas

- Env vars don't persist between Bash tool calls — persist ids to a scratch file and `source` it.
- Nuxt's async-context transform covers `middleware/` and `plugins/` only; calling `navigateTo` after an `await` inside `app/utils/*` throws "composable called outside Nuxt instance" (500 on SSR).
- Test users accumulate in the dev DB; delete test orgs via the owner's `organization/delete` when done.
