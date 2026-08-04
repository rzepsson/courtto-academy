import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { AREA_ROLES } from '../../shared/permissions'
import { db } from '../../server/utils/db'
import { listUserMemberships } from '../../server/utils/services/membership'
import { getOrgEntitlement } from '../../server/utils/services/billing'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { requireActiveMembership } from '../../server/utils/org'
import { addMember, createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'
import type { SeededUser } from './helpers'

// `server/utils/org.ts` reaches for three Nuxt server auto-imports as globals:
// requireUserSession, listUserMemberships and createError. Provide them here so
// we exercise the *real* resolution + role-gate logic against the test database.
// requireUserSession is stubbed (session acquisition is Better Auth's concern);
// listUserMemberships is the real query so the find-or-first fallback is tested
// against actual rows.
interface FakeSession {
  user: { id: string }
  session: { activeOrganizationId: string | null }
}

let currentSession: FakeSession | null = null

const globals = globalThis as unknown as Record<string, unknown>
// A method-less event reads as a "read" — the subscription gate only fires on an
// explicit mutating verb (see MUTATING_METHODS in org.ts).
const event = {} as H3Event
const postEvent = { method: 'POST' } as H3Event

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)

  globals.requireUserSession = async () => {
    if (!currentSession) {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    }
    return currentSession
  }

  globals.listUserMemberships = listUserMemberships
  // org.ts calls getOrgEntitlement as an auto-import global for the subscription gate.
  globals.getOrgEntitlement = getOrgEntitlement
})

// Backdate an org past its 14-day trial so it has no entitlement without a sub.
async function lapseTrial(organizationId: string): Promise<void> {
  await db.execute(
    sql`UPDATE "organization" SET "created_at" = now() - interval '30 days' WHERE "id" = ${organizationId}`
  )
}

async function sessionFor(user: SeededUser, activeOrganizationId: string | null): Promise<void> {
  currentSession = { user: { id: user.userId }, session: { activeOrganizationId } }
}

describe.skipIf(!hasTestDb)('requireActiveMembership', () => {
  beforeEach(async () => {
    currentSession = null
    await resetDb()
  })

  it('allows a matching role', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await sessionFor(owner, orgId)

    const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

    expect(membership.role).toBe('owner')
    expect(membership.organization.id).toBe(orgId)
    // An active member (no sidecar row) resolves as active by default.
    expect(membership.status).toBe('active')
  })

  it('403s a suspended member with a stable code, regardless of role match', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    const coach = await signUp({ email: uniqueEmail('coach') })
    const coachMemberId = await addMember(orgId, coach.userId, 'coach')
    await upsertMemberProfile(orgId, coachMemberId, { status: 'suspended' })
    await sessionFor(coach, orgId)

    // The coach role would satisfy the coach area, but a suspended membership is
    // denied before the role check.
    await expect(requireActiveMembership(event, AREA_ROLES.coach)).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'MEMBERSHIP_INACTIVE' }
    })
  })

  it('403s when the role is not allowed for the area', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await sessionFor(owner, orgId)

    // An owner is not a coach — the coach area must reject them.
    await expect(requireActiveMembership(event, AREA_ROLES.coach)).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Insufficient role'
    })
  })

  it('403s when the user has no membership at all', async () => {
    const loner = await signUp()
    await sessionFor(loner, null)

    await expect(requireActiveMembership(event)).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'No active organization'
    })
  })

  it('falls back to a real membership when the active org id is stale (no 403)', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    // Simulate a session whose activeOrganizationId points at a school the user
    // was removed from — they still own Ace, so this must resolve, not 403.
    await sessionFor(owner, 'org_that_no_longer_exists')

    const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

    expect(membership.organization.id).toBe(orgId)
  })

  it('402s a mutating request when the school subscription has lapsed', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await lapseTrial(orgId)
    await sessionFor(owner, orgId)

    await expect(requireActiveMembership(postEvent, AREA_ROLES.school)).rejects.toMatchObject({
      statusCode: 402,
      data: { code: 'SUBSCRIPTION_INACTIVE' }
    })
  })

  it('allows a mutating request while on the trial', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await sessionFor(owner, orgId)

    const { membership } = await requireActiveMembership(postEvent, AREA_ROLES.school)
    expect(membership.role).toBe('owner')
  })

  it('allows a READ even when the subscription has lapsed (client routes to /billing-required)', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
    await lapseTrial(orgId)
    await sessionFor(owner, orgId)

    // Method-less event = a read → the gate does not fire, so the membership still
    // resolves (the client, not this guard, sends a lapsed school to billing).
    const { membership } = await requireActiveMembership(event, AREA_ROLES.school)
    expect(membership.organization.id).toBe(orgId)
  })

  it('does not leak another tenant when resolving the active membership', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })

    // A second, unrelated school the owner is NOT part of.
    const stranger = await signUp({ email: uniqueEmail('stranger') })
    const otherOrgId = await createOrg(stranger, { name: 'Rival', slug: 'rival' })

    await sessionFor(owner, otherOrgId)

    const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

    // Active id pointed at Rival, but the owner has no membership there, so
    // find-or-first resolves to their own school — never Rival.
    expect(membership.organization.id).toBe(orgId)
    expect(membership.organization.id).not.toBe(otherOrgId)
  })
})
