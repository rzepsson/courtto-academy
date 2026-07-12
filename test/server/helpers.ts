import { env } from 'node:process'
import { and, eq, sql } from 'drizzle-orm'
// `auth` and `db` are plain module-level singletons designed to load outside
// Nuxt (the `auth` CLI does the same), so we can import them directly. They read
// DATABASE_URL, which vitest.config.ts pins to TEST_DATABASE_URL for this
// project — writes land in the disposable test database, never the dev one.
import { auth } from '../../server/utils/auth'
import { db } from '../../server/utils/db'
import { member } from '../../server/database/schema'
import type { OrgRole } from '../../shared/permissions'

// The whole server suite is gated on this — without a real test database the
// suites `describe.skipIf` themselves out. We deliberately do NOT fall back to
// the dev DATABASE_URL.
export const hasTestDb = Boolean(env.TEST_DATABASE_URL)

// Better Auth's default cookie name; used to build a request-style cookie header
// from the Set-Cookie a sign-up/sign-in response returns.
function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')
}

export interface SeededUser {
  userId: string
  email: string
  // A cookie header string that authenticates this user for auth.api.* calls.
  cookie: string
  headers: Headers
}

let counter = 0

// Unique-per-call address so tests never collide on the user/email unique index.
export function uniqueEmail(prefix = 'user'): string {
  counter += 1
  return `${prefix}.${Date.now()}.${counter}@test.local`
}

export async function signUp(overrides: Partial<{ name: string, email: string, password: string }> = {}): Promise<SeededUser> {
  const email = overrides.email ?? uniqueEmail()
  const password = overrides.password ?? 'password123'
  const name = overrides.name ?? 'Test User'

  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email, password },
    returnHeaders: true
  })

  const cookie = cookieHeader(headers)

  return {
    userId: response.user.id,
    email,
    cookie,
    headers: new Headers({ cookie })
  }
}

export async function createOrg(user: SeededUser, input: { name: string, slug: string }): Promise<string> {
  const org = await auth.api.createOrganization({
    body: { name: input.name, slug: input.slug },
    headers: user.headers
  })

  if (!org) {
    throw new Error('createOrganization returned null')
  }

  return org.id
}

// Adds a user to an org programmatically (server-only Better Auth API — rule 4,
// no direct insert) and returns the created membership id. Used to seed coaches
// and students for schedule/enrolment tests.
export async function addMember(organizationId: string, userId: string, role: OrgRole): Promise<string> {
  await auth.api.addMember({ body: { userId, organizationId, role } })
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  if (!row) throw new Error('addMember: membership not found after insert')
  return row.id
}

export async function invite(
  inviter: SeededUser,
  input: { email: string, role: OrgRole, organizationId: string }
): Promise<string> {
  const invitation = await auth.api.createInvitation({
    body: { email: input.email, role: input.role, organizationId: input.organizationId },
    headers: inviter.headers
  })

  return invitation.id
}

// Ages an invitation into the past to exercise the expiry filter. This is a
// deliberate test-only write — product code never touches Better Auth tables
// directly (CLAUDE.md rule 4) and there is no API to set a past expiry.
export async function expireInvitation(invitationId: string): Promise<void> {
  await db.execute(
    sql`UPDATE "invitation" SET "expires_at" = now() - interval '1 day' WHERE "id" = ${invitationId}`
  )
}

// Truncate every Better Auth table between tests so each starts from empty. Order
// is irrelevant with CASCADE; RESTART IDENTITY keeps any serial columns clean.
export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "invitation", "member", "session", "account", "verification", "organization", "user" RESTART IDENTITY CASCADE`
  )
}
