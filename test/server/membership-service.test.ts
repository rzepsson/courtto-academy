import { beforeEach, describe, expect, it } from 'vitest'
import {
  getInvitationLanding,
  listOrganizationMembers,
  listPendingInvitations
} from '../../server/utils/services/membership'
import {
  createOrg,
  expireInvitation,
  hasTestDb,
  invite,
  resetDb,
  signUp,
  uniqueEmail
} from './helpers'

describe.skipIf(!hasTestDb)('membership service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  describe('listPendingInvitations', () => {
    it('includes a fresh invitation and excludes an expired one', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })

      const freshEmail = uniqueEmail('fresh')
      const staleEmail = uniqueEmail('stale')
      await invite(owner, { email: freshEmail, role: 'coach', organizationId: orgId })
      const staleId = await invite(owner, { email: staleEmail, role: 'student', organizationId: orgId })

      let pending = await listPendingInvitations(orgId)
      expect(pending.map(i => i.email).sort()).toEqual([freshEmail, staleEmail].sort())

      await expireInvitation(staleId)

      pending = await listPendingInvitations(orgId)
      expect(pending.map(i => i.email)).toEqual([freshEmail])
      expect(pending.map(i => i.email)).not.toContain(staleEmail)
    })
  })

  describe('multi-tenant isolation', () => {
    it('scopes members to their own organization', async () => {
      const ownerA = await signUp({ email: uniqueEmail('a') })
      const orgA = await createOrg(ownerA, { name: 'Ace', slug: 'ace' })

      const ownerB = await signUp({ email: uniqueEmail('b') })
      const orgB = await createOrg(ownerB, { name: 'Bay', slug: 'bay' })

      const membersA = await listOrganizationMembers(orgA)
      const membersB = await listOrganizationMembers(orgB)

      expect(membersA.map(m => m.user.email)).toEqual([ownerA.email])
      expect(membersB.map(m => m.user.email)).toEqual([ownerB.email])
      expect(membersA.map(m => m.user.email)).not.toContain(ownerB.email)
    })

    it('scopes pending invitations to their own organization', async () => {
      const ownerA = await signUp({ email: uniqueEmail('a') })
      const orgA = await createOrg(ownerA, { name: 'Ace', slug: 'ace' })

      const ownerB = await signUp({ email: uniqueEmail('b') })
      const orgB = await createOrg(ownerB, { name: 'Bay', slug: 'bay' })

      const invitedEmail = uniqueEmail('invitee')
      await invite(ownerA, { email: invitedEmail, role: 'coach', organizationId: orgA })

      expect((await listPendingInvitations(orgA)).map(i => i.email)).toEqual([invitedEmail])
      // Org B must not see org A's invitation.
      expect(await listPendingInvitations(orgB)).toEqual([])
    })
  })

  describe('getInvitationLanding', () => {
    it('masks the invitee email and never leaks the local part', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
      const invitationId = await invite(owner, {
        email: 'coach.person@example.com',
        role: 'coach',
        organizationId: orgId
      })

      const landing = await getInvitationLanding(invitationId)

      expect(landing).not.toBeNull()
      expect(landing!.maskedEmail).toBe('c***********@example.com')
      expect(landing!.maskedEmail).not.toContain('oach.person')
      expect(landing!.role).toBe('coach')
      expect(landing!.status).toBe('pending')
      expect(landing!.organization.slug).toBe('ace')
    })

    it('reports an expired invitation as expired', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
      const invitationId = await invite(owner, {
        email: uniqueEmail('coach'),
        role: 'coach',
        organizationId: orgId
      })

      await expireInvitation(invitationId)
      const landing = await getInvitationLanding(invitationId)

      expect(landing!.status).toBe('expired')
    })

    it('returns null for an unknown invitation id', async () => {
      expect(await getInvitationLanding('does-not-exist')).toBeNull()
    })
  })
})
