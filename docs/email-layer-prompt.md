# Prompt — build the email / transactional-comms layer for courtto-academy

Paste everything below the line into a fresh session (ideally on a dedicated
branch). It is self-contained: it assumes no memory of prior conversations.

---

You are a senior engineer on a **top-end enterprise B2B SaaS**. Build the
**transactional email layer**. This is currently the #1 V1 blocker, and the bar
for this codebase is high: read `CLAUDE.md` first and follow its conventions
exactly — they are not suggestions, they are how this repo stays coherent.

## The problem (verified in code — don't re-derive it, but do sanity-check it)

**Today, a user who forgets their password is locked out forever.**

- `server/utils/auth.ts` enables `emailAndPassword: { enabled: true }` but
  configures **no `sendResetPassword`** — Better Auth's reset flow therefore
  cannot work — and there are **no `/forgot-password` or `/reset-password`
  pages**.
- **There is no mail provider at all** in the repo (no Resend/Postmark/SES/
  nodemailer, no `sendVerificationEmail`). Grep confirms zero.
- **Invitations are copyable links only.** `auth.ts` says so in a comment
  ("Invites are delivered as copyable links (no mail provider yet)") and gives
  them a 7-day expiry to compensate. An admin inviting 15 coaches must copy and
  deliver 15 links by hand.
- Students have a self-service join code, so bulk student onboarding already
  works without email. **Staff invitations are the painful path.**

At 200 students, "I forgot my password" is a weekly event. Nothing else in V1
matters if a parent can't get back into their account.

## Provider & transport — DECIDED (do not re-litigate; the reasoning is below)

- **Provider: Brevo (formerly Sendinblue), FR.** Chosen because this product
  processes **children's personal data** (see the guardian + consent models in
  `CLAUDE.md`), so **EU data residency + a signed DPA is a hard requirement**, not
  a preference. Brevo is EU-resident, GDPR-native, managed (built-in suppression /
  bounce handling / per-message logs), and its free tier covers the pilot. A
  US-based provider (Resend, Postmark, SendGrid) was **deliberately rejected**: it
  reopens the GDPR/transfer question the rest of the app is built to close.
  *(Verify Brevo's current free-tier limits and sign the DPA before going live.)*
- **Transport: `nodemailer` over Brevo's SMTP relay.** One mature, portable
  library — the app never depends on a vendor SDK. Because it's plain SMTP, the
  provider is swappable by env alone: the documented scale-up path is **AWS SES
  `eu-central-1` (Frankfurt)** — same EU residency, cheaper at volume, but you'd
  wire bounce/complaint handling yourself (SES → SNS → webhook). `mailer.ts` makes
  that a one-file change; **do not** couple anything to Brevo specifically.
- **Dev: Mailpit** (local catcher) — every mail is viewable in a browser, nothing
  leaves the machine. The "no provider configured" path must be **loud** (print
  the link / fail visibly), never a silent no-op (see the design decision below).

## Scope — build this

1. **A mail transport abstraction** (`server/utils/mailer.ts`) — the seam that
   keeps the provider above swappable.
   Follow the shape of `server/utils/storage.ts`: a plain module-level singleton,
   env read lazily via `import { env } from 'node:process'`, **no
   `useRuntimeConfig`, no factories** (CLAUDE.md rule 2). Speak SMTP via
   `nodemailer`; nothing outside this file may know which provider is behind it.
2. **Password reset, end to end.** Wire Better Auth's `sendResetPassword`, add
   the `/forgot-password` + `/reset-password` pages (they belong on the `auth`
   layout, like login/register). This is the blocker — do it first.
3. **Invitation emails.** Wire the organization plugin's `sendInvitationEmail`.
   **Keep the copyable link exactly as it is** — it works, and it is the fallback
   when mail fails or bounces. The email is *additive*, never a replacement.
4. **Localized email content** (see the design decisions below — rule 5 applies to
   emails too; they are user-facing text).

## Design decisions you must make deliberately (do not default your way through these)

These are the parts where a naive implementation quietly ships a bug. Decide,
write the decision down in `CLAUDE.md`, and justify it in the PR description.

- **Dev/unset-provider behaviour.** `storage.ts` degrades to a 503 when S3 env is
  missing, which is fine for logo uploads. **Email must NOT fail silently** — a
  password reset that no-ops in dev is a flow you won't notice is broken. Prefer a
  loud console transport that prints the link, or a local catcher (Mailpit). Make
  the "no provider configured" state obvious, never quiet.
- **User enumeration.** `POST /forgot-password` must respond **identically**
  whether or not the account exists. Verify what Better Auth does here rather than
  assuming; if it leaks, make the endpoint uniform. Also confirm rate limiting on
  the reset request (Better Auth has built-in rate limiting — check it applies).
- **Which language does an email use?** This is genuinely non-obvious:
  - An **invitation** has an org context → `orgProfile.locale` already exists and
    is documented as "default notification language". Use it.
  - A **password reset** has no org context (the user may have none, or several) →
    `orgProfile.locale` is meaningless. Resolve from the request instead
    (i18n cookie / `Accept-Language`), and pick a documented fallback.
- **How do you translate on the server?** Emails are sent from Nitro, outside
  vue-i18n. Rule 5 forbids hardcoded user-facing English. Decide the mechanism
  (server-side message catalog vs `@nuxtjs/i18n` server utils) and keep the copy
  in `i18n/locales/*.json` if at all possible — one place for all product text.
- **Email verification stays OFF unless the product owner says otherwise.**
  `CLAUDE.md` records it as a deliberate decision ("sign-up logs the user straight
  in"). Turning it on changes the signup flow — that is a product call, not a
  side effect of adding a mail provider.
- **Do not wire notifications to email yet.** The in-app notification system
  (`services/notifications.ts`) is the next phase's job. Design the mailer so it
  *can* consume it later; do **not** add an unused hook now (see doctrine below).

## Non-negotiables (this repo's doctrine — violating these is a rejected PR)

From `CLAUDE.md`, plus the doctrine the members/scheduling work was held to:

- **Services pattern.** All DB access lives in `server/utils/services/*`; handlers
  in `server/api/*` are thin and call services only.
- **Rule 4 — Better Auth owns its tables.** Never write `user`/`member`/
  `invitation`/`organization` with Drizzle. Mutate via `auth.api.*` (server) or
  `authClient.*` (client).
- **Rule 5 — no hardcoded user-facing text, anywhere, including emails.** Failures
  carry a **stable machine code**; the client maps it to `error.codes.<CODE>` in
  `i18n/locales/*.json`. **Never surface a raw provider/Better Auth message** to a
  user — it's untranslated and often leaks internals.
- **`shared/` is pure** — no Nuxt/Node imports; it loads in any context and is
  unit-tested directly.
- **One shared Zod schema per concept**, parameterized by a message resolver
  (client → localized keys, server → raw codes), so form and API cannot drift.
  See `shared/org-profile-schema.ts` for the canonical example.
- **Guards live in the service, not only in the handler or the UI** — so they
  cannot be bypassed by a crafted request.
- **Every query scoped by `organizationId`**, never by id alone.
- **No inert features.** Do not add a column nobody writes, a setting nobody
  reads, or a hook nobody calls. If it doesn't do something today, it doesn't ship
  today. (A seam is fine only when `CLAUDE.md` documents it as one.)
- **No data without a reader.** If you record it, some surface must show it.
- **Derive, don't store.** Computed state beats a stored flag that drifts.
- **Comments explain the non-obvious decision, never the obvious code.** This repo
  may go public.

## Testing — the bar, and how to actually run it

`TESTING.md` has the full guide. The gate is: **`pnpm typecheck`, `pnpm lint`,
`pnpm test` all green, plus the server suite against a real Postgres.**

- **Unit (`test/unit/**`, `pnpm test`)** — every pure function: locale resolution,
  template rendering (render to a string and assert on it), any address/format
  helpers. No DB, always runnable.
- **Server (`test/server/**`, `pnpm test:server`)** — gated on
  `TEST_DATABASE_URL`; unset → the suite skips green. Seed **only** through
  `auth.api.*` (rule 4). Existing suites are the model
  (`member-profile-service.test.ts`, `require-active-membership.test.ts`).
- **Never send real email from a test.** Inject a **recording transport** and
  assert on what would have been sent: one message, to the right address, in the
  right language, containing a working token/link. If the mailer can't be injected
  with a fake transport, that's a design smell — fix the design, don't mock the
  network.
- **Run the server suite against a real Postgres before claiming done.** This is
  not optional ceremony: on this codebase a keyset query passed `typecheck` and
  `lint` and still failed at the driver level against a real database. Static gates
  do not catch driver, constraint, or migration bugs.

  ```bash
  # NOTE: on this Windows host Hyper-V reserves the 55xxx port range —
  # `docker run -p 55432:5432` fails with a socket-permission error. Use a low port.
  docker run -d --name courtto_test_db -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=courtto_test -p 5433:5432 postgres:16

  # then, with TEST_DATABASE_URL + BETTER_AUTH_SECRET set:
  #   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/courtto_test
  #   BETTER_AUTH_SECRET=<any non-empty value>
  pnpm test:server

  docker rm -f courtto_test_db   # it's disposable — clean up
  ```

- **Report results with real output.** Never claim green without showing it. If
  something fails or is skipped, say so plainly.

## Environment gotchas (these cost hours if missed)

- **Run the dev server on port 3000.** `.env` has
  `BETTER_AUTH_URL=http://localhost:3000`; on any other port Better Auth rejects
  org mutations with `403 INVALID_ORIGIN`. Sign-up/sign-in still work, so a
  passing signup can mask a misconfigured origin.
- **`server/database/schema.ts` is generated** — never hand-edit. App-owned tables
  go in `app-schema.ts`. Schema changes: `pnpm db:generate` → `pnpm db:migrate`.
  Never `db:push`.
- **`server/utils/auth.ts` and everything it imports is loaded by the `auth` CLI
  outside Nuxt** — those files need explicit imports (no auto-imports, no Nuxt
  aliases). Your mailer will be imported by `auth.ts`, so this applies to it.
- **Nuxt UI v4 renamed `UButtonGroup` → `UFieldGroup`** (the old name fails
  silently at runtime).
- `.claude/skills/verify/SKILL.md` documents curl flows for driving auth locally.

## Deliverables

- `server/utils/mailer.ts` + provider wiring in `server/utils/auth.ts`
  (`sendResetPassword`, `sendInvitationEmail`).
- `/forgot-password` + `/reset-password` pages (`auth` layout), with localized
  copy and stable error codes.
- Email templates (HTML + a plain-text alternative), brand-consistent, localized.
- Env vars documented in `CLAUDE.md` under **Conventions → Env vars** (plain, no
  `NUXT_` prefix), including the unset/dev behaviour.
- Tests: unit + server, per the bar above.
- `CLAUDE.md` updated: a short section describing the mail layer, the design
  decisions you made and **why**, and the dev/unset behaviour. Remove the now-stale
  "no mail provider yet" notes (in `auth.ts` and the invitations section).
- Update the **Known gaps (V1 backlog)** section in `CLAUDE.md`: strike the email
  blocker, and leave the rest honest.

## Definition of done

- A user can request a reset, receive the mail, set a new password, and sign in.
- An invited coach receives an email; the copyable link still works unchanged.
- Nothing user-facing is hardcoded English; every failure has a stable code mapped
  in both `en.json` and `pl.json`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `pnpm test:server` green
  against a real Postgres, with output shown.

The provider and transport are decided (Brevo over `nodemailer`/SMTP, Mailpit in
dev — see the top of this doc). Start by settling the two decisions still open —
the exact dev/unset behaviour and the server-side translation mechanism — then do
**password reset end-to-end** (the blocker) before touching invitations. Confirm
the account-enumeration and rate-limiting behaviour of the reset endpoint before
you call it done.
