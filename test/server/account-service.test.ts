import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  exportAccountData,
  findAccountDeletionBlocker,
  prepareAccountDeletion
} from '../../server/utils/services/account'
import { listOrgAudit } from '../../server/utils/services/audit'
import { upsertMemberProfile } from '../../server/utils/services/memberProfile'
import { createMemberGuardian } from '../../server/utils/services/memberGuardians'
import { recordMemberConsent } from '../../server/utils/services/memberConsents'
import { createCourt } from '../../server/utils/services/courts'
import { createLesson } from '../../server/utils/services/schedule'
import { enrollInSeries, markAttendance } from '../../server/utils/services/enrollment'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { createNotification } from '../../server/utils/services/notifications'
import { auth } from '../../server/utils/auth'
import { db } from '../../server/utils/db'
import { member, session, user } from '../../server/database/schema'
import { addMember, createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'
import type { SeededUser } from './helpers'

const globals = globalThis as unknown as Record<string, unknown>

beforeAll(() => {
  globals.createError = (input: { statusCode: number, statusMessage?: string, data?: unknown }) =>
    Object.assign(new Error(input.statusMessage ?? 'Error'), input)
})

let seq = 0

async function memberIdOf(organizationId: string, userId: string): Promise<string> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return row!.id
}

interface School {
  owner: SeededUser
  orgId: string
  courtId: string
  coachMemberId: string
}

async function seedSchool(name = 'Ace'): Promise<School> {
  seq += 1
  const owner = await signUp({ email: uniqueEmail('owner') })
  const orgId = await createOrg(owner, { name, slug: `${name.toLowerCase()}-${Date.now()}-${seq}` })
  await upsertOrgProfile(orgId, { sports: ['tennis'], timezone: 'Europe/Warsaw' })
  const court = await createCourt(orgId, { name: 'Court 1', sport: 'tennis' }, owner.userId)
  const coachUser = await signUp({ email: uniqueEmail('coach') })
  const coachMemberId = await addMember(orgId, coachUser.userId, 'coach')
  return { owner, orgId, courtId: court.id, coachMemberId }
}

describe.skipIf(!hasTestDb)('account service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  // ─── Deletion guard ────────────────────────────────────────────────────────

  describe('findAccountDeletionBlocker', () => {
    it('blocks the sole owner of a school, naming it', async () => {
      const school = await seedSchool('Solo')

      const blocker = await findAccountDeletionBlocker(school.owner.userId)
      expect(blocker).toEqual({ code: 'ACCOUNT_OWNS_SCHOOL', organizationName: 'Solo' })
    })

    it('allows an owner once a second owner exists', async () => {
      const school = await seedSchool()
      const successor = await signUp({ email: uniqueEmail('successor') })
      await addMember(school.orgId, successor.userId, 'owner')

      expect(await findAccountDeletionBlocker(school.owner.userId)).toBeNull()
      expect(await findAccountDeletionBlocker(successor.userId)).toBeNull()
    })

    it('never blocks a non-owner, however much history they have', async () => {
      const school = await seedSchool()
      const student = await signUp({ email: uniqueEmail('stu') })
      await addMember(school.orgId, student.userId, 'student')

      expect(await findAccountDeletionBlocker(student.userId)).toBeNull()
      // The seeded coach is a member of the same school.
      expect(await findAccountDeletionBlocker(school.owner.userId)).not.toBeNull()
    })

    it('does not block a user who belongs to no school', async () => {
      const loner = await signUp({ email: uniqueEmail('loner') })
      expect(await findAccountDeletionBlocker(loner.userId)).toBeNull()
    })

    // Owning one school outright blocks deletion even when another school of
    // theirs is safely co-owned — the guard is per-school, not an aggregate.
    it('blocks when only one of several schools would be stranded', async () => {
      const safe = await seedSchool('Safe')
      const coOwner = await signUp({ email: uniqueEmail('co') })
      await addMember(safe.orgId, coOwner.userId, 'owner')

      seq += 1
      const strandedId = await createOrg(safe.owner, {
        name: 'Stranded',
        slug: `stranded-${Date.now()}-${seq}`
      })

      const blocker = await findAccountDeletionBlocker(safe.owner.userId)
      expect(blocker?.organizationName).toBe('Stranded')
      expect(strandedId).toBeTruthy()
    })
  })

  // ─── Pre-deletion bookkeeping ──────────────────────────────────────────────

  describe('prepareAccountDeletion', () => {
    it('records one audit entry per school, snapshotting name and role', async () => {
      const first = await seedSchool('First')
      const second = await seedSchool('Second')

      const student = await signUp({ name: 'Kacper Nowak', email: uniqueEmail('stu') })
      await addMember(first.orgId, student.userId, 'student')
      await addMember(second.orgId, student.userId, 'coach')

      await prepareAccountDeletion(student.userId, 'Kacper Nowak')

      const firstFeed = await listOrgAudit(first.orgId)
      const entry = firstFeed.entries.find(row => row.action === 'member.account_deleted')
      expect(entry).toBeDefined()
      // Denormalized snapshot: the name must survive the user row it came from.
      expect(entry!.data).toMatchObject({ targetName: 'Kacper Nowak', role: 'student' })

      // The same event lands in the second school with THAT school's role.
      const secondFeed = await listOrgAudit(second.orgId)
      const other = secondFeed.entries.find(row => row.action === 'member.account_deleted')
      expect(other!.data).toMatchObject({ targetName: 'Kacper Nowak', role: 'coach' })
    })

    it('is tenant-scoped — an unrelated school records nothing', async () => {
      const mine = await seedSchool('Mine')
      const other = await seedSchool('Other')

      const student = await signUp({ email: uniqueEmail('stu') })
      await addMember(mine.orgId, student.userId, 'student')

      await prepareAccountDeletion(student.userId, 'Someone')

      const feed = await listOrgAudit(other.orgId)
      expect(feed.entries.filter(row => row.action === 'member.account_deleted')).toHaveLength(0)
    })

    it('is a no-op for a user who belongs to no school', async () => {
      const loner = await signUp({ email: uniqueEmail('loner') })
      await expect(prepareAccountDeletion(loner.userId, 'Loner')).resolves.toBeUndefined()
    })
  })

  // ─── Data export ───────────────────────────────────────────────────────────

  describe('exportAccountData', () => {
    it('returns the account, every membership, and the records about them', async () => {
      const school = await seedSchool('Akademia')
      const student = await signUp({ name: 'Kacper Nowak', email: uniqueEmail('stu') })
      const studentMemberId = await addMember(school.orgId, student.userId, 'student')
      const ownerMemberId = await memberIdOf(school.orgId, school.owner.userId)

      await upsertMemberProfile(school.orgId, studentMemberId, {
        dateOfBirth: '2012-06-01',
        notes: 'Staff-only assessment',
        tags: ['beginner']
      })
      const guardian = await createMemberGuardian(school.orgId, studentMemberId, {
        name: 'Anna Nowak',
        relationship: 'mother',
        phone: '+48500600700',
        email: 'anna@example.com',
        isPrimary: true,
        notes: 'Collects on Tuesdays'
      })
      await recordMemberConsent(
        school.orgId,
        studentMemberId,
        'image',
        { status: 'granted', guardianId: guardian!.id, documentVersion: 'v1', notes: 'paper form' },
        ownerMemberId
      )

      const lesson = await createLesson(school.orgId, {
        type: 'group',
        sport: 'tennis',
        title: 'Grupa Junior',
        dtStart: '2026-09-07T17:00',
        durationMin: 60,
        defaultCourtId: school.courtId,
        coachMemberId: school.coachMemberId
      }, school.owner.userId)

      await enrollInSeries(school.orgId, lesson.series.id, studentMemberId)
      const session = lesson.sessions[0]!
      await markAttendance(
        school.orgId,
        session.id,
        [{ studentMemberId, status: 'present' }],
        school.coachMemberId
      )

      await createNotification({
        userId: student.userId,
        organizationId: school.orgId,
        type: 'lesson.reminder',
        data: { title: 'Grupa Junior' }
      })

      const data = await exportAccountData(student.userId)
      expect(data).not.toBeNull()

      expect(data!.account).toMatchObject({
        id: student.userId,
        name: 'Kacper Nowak',
        email: student.email
      })

      expect(data!.memberships).toHaveLength(1)
      const membership = data!.memberships[0]!
      expect(membership.organization).toEqual({
        name: 'Akademia',
        slug: expect.stringContaining('akademia-')
      })
      expect(membership.role).toBe('student')
      expect(membership.status).toBe('active')
      expect(membership.dateOfBirth).toBe('2012-06-01')

      expect(membership.guardians).toHaveLength(1)
      expect(membership.guardians[0]).toMatchObject({
        name: 'Anna Nowak',
        relationship: 'mother',
        email: 'anna@example.com',
        isPrimary: true
      })

      expect(membership.consents).toHaveLength(1)
      expect(membership.consents[0]).toMatchObject({ type: 'image', status: 'granted' })
      expect(membership.consents[0]!.grantedAt).toBeInstanceOf(Date)

      expect(membership.enrollments).toHaveLength(1)
      expect(membership.enrollments[0]).toMatchObject({ group: 'Grupa Junior', status: 'enrolled' })

      expect(membership.attendance).toHaveLength(1)
      expect(membership.attendance[0]).toMatchObject({ group: 'Grupa Junior', status: 'present' })

      expect(data!.notifications).toHaveLength(1)
      expect(data!.notifications[0]!.type).toBe('lesson.reminder')
    })

    // The staff-only CRM fields are the ones a self-service download must not
    // reveal — a school's internal assessment of a student is not part of the
    // account-holder's own copy (see the service's rationale).
    it('omits staff-only CRM fields', async () => {
      const school = await seedSchool()
      const student = await signUp({ email: uniqueEmail('stu') })
      const studentMemberId = await addMember(school.orgId, student.userId, 'student')
      const ownerMemberId = await memberIdOf(school.orgId, school.owner.userId)

      await upsertMemberProfile(school.orgId, studentMemberId, {
        notes: 'Struggles with backhand',
        tags: ['needs-attention']
      })
      await createMemberGuardian(school.orgId, studentMemberId, {
        name: 'Parent',
        relationship: 'father',
        phone: '+48500600700',
        email: '',
        isPrimary: true,
        notes: 'Do not contact before 5pm'
      })
      await recordMemberConsent(
        school.orgId,
        studentMemberId,
        'marketing',
        { status: 'granted', documentVersion: 'v1', notes: 'internal remark' },
        ownerMemberId
      )

      const data = await exportAccountData(student.userId)
      const serialized = JSON.stringify(data)

      expect(serialized).not.toContain('Struggles with backhand')
      expect(serialized).not.toContain('needs-attention')
      expect(serialized).not.toContain('Do not contact before 5pm')
      expect(serialized).not.toContain('internal remark')
    })

    it('spans every school the person belongs to', async () => {
      const first = await seedSchool('Alpha')
      const second = await seedSchool('Beta')
      const person = await signUp({ email: uniqueEmail('multi') })
      await addMember(first.orgId, person.userId, 'student')
      await addMember(second.orgId, person.userId, 'coach')

      const data = await exportAccountData(person.userId)
      const byName = new Map(data!.memberships.map(row => [row.organization.name, row.role]))
      expect(byName.get('Alpha')).toBe('student')
      expect(byName.get('Beta')).toBe('coach')
    })

    it('never leaks another user\'s records', async () => {
      const school = await seedSchool()
      const mine = await signUp({ name: 'Mine', email: uniqueEmail('mine') })
      const theirs = await signUp({ name: 'Theirs', email: uniqueEmail('theirs') })
      const myMemberId = await addMember(school.orgId, mine.userId, 'student')
      const theirMemberId = await addMember(school.orgId, theirs.userId, 'student')

      await createMemberGuardian(school.orgId, theirMemberId, {
        name: 'Their Parent',
        relationship: 'mother',
        phone: '+48500600700',
        email: 'their.parent@example.com',
        isPrimary: true,
        notes: ''
      })
      await createMemberGuardian(school.orgId, myMemberId, {
        name: 'My Parent',
        relationship: 'father',
        phone: '+48500600701',
        email: 'my.parent@example.com',
        isPrimary: true,
        notes: ''
      })
      await createNotification({
        userId: theirs.userId,
        organizationId: school.orgId,
        type: 'lesson.cancelled',
        data: null
      })

      const data = await exportAccountData(mine.userId)
      const serialized = JSON.stringify(data)

      expect(data!.memberships[0]!.guardians).toHaveLength(1)
      expect(data!.memberships[0]!.guardians[0]!.name).toBe('My Parent')
      expect(serialized).not.toContain('Their Parent')
      expect(serialized).not.toContain('their.parent@example.com')
      // Their notification belongs to their inbox, not this export.
      expect(data!.notifications).toHaveLength(0)
    })

    it('returns null for an unknown user id', async () => {
      expect(await exportAccountData('does-not-exist')).toBeNull()
    })

    it('handles a brand-new account with no memberships', async () => {
      const fresh = await signUp({ email: uniqueEmail('fresh') })
      const data = await exportAccountData(fresh.userId)

      expect(data!.memberships).toEqual([])
      expect(data!.notifications).toEqual([])
      expect(data!.exportedAt).toBeInstanceOf(Date)
    })
  })

  // ─── Better Auth wiring ────────────────────────────────────────────────────
  //
  // The service tests above prove the RULES; these prove the CONFIG in
  // server/utils/auth.ts actually applies them. Nothing else in the suite loads
  // the user block, so a typo'd option (a disabled deleteUser, a change-email
  // flow with no enabled branch, a beforeDelete that never runs) would otherwise
  // pass every static gate and fail only in the browser.

  describe('account endpoints', () => {
    it('changes the email address directly', async () => {
      const person = await signUp({ email: uniqueEmail('rename') })
      const newEmail = uniqueEmail('renamed')

      await auth.api.changeEmail({ body: { newEmail }, headers: person.headers })

      const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, person.userId)).limit(1)
      expect(row!.email).toBe(newEmail)

      // The new address is the one that signs in.
      await expect(auth.api.signInEmail({
        body: { email: newEmail, password: 'password123' }
      })).resolves.toBeTruthy()
    })

    it('changes the password and evicts other sessions', async () => {
      const person = await signUp({ email: uniqueEmail('pw') })
      // A second sign-in = a second device.
      await auth.api.signInEmail({ body: { email: person.email, password: 'password123' } })

      await auth.api.changePassword({
        body: { currentPassword: 'password123', newPassword: 'new-password-456', revokeOtherSessions: true },
        headers: person.headers
      })

      await expect(auth.api.signInEmail({
        body: { email: person.email, password: 'new-password-456' }
      })).resolves.toBeTruthy()

      const remaining = await db.select({ id: session.id }).from(session).where(eq(session.userId, person.userId))
      // The revoke wiped every session; the caller's own is re-issued as a fresh
      // token, so at most the new one and this sign-in survive — never the evicted device.
      expect(remaining.length).toBeLessThanOrEqual(2)
    })

    it('refuses to delete the sole owner of a school, with the localizable code', async () => {
      const school = await seedSchool('Guarded')

      await expect(auth.api.deleteUser({
        body: { password: 'password123' },
        headers: school.owner.headers
      })).rejects.toMatchObject({ body: { code: 'ACCOUNT_OWNS_SCHOOL' } })

      // The guard aborted before anything was removed.
      const [stillThere] = await db.select({ id: user.id }).from(user).where(eq(user.id, school.owner.userId)).limit(1)
      expect(stillThere).toBeDefined()
    })

    it('deletes a member, cascading the membership and leaving the trail behind', async () => {
      const school = await seedSchool('Leaver')
      const student = await signUp({ name: 'Ola Leaver', email: uniqueEmail('leaver') })
      await addMember(school.orgId, student.userId, 'student')

      await auth.api.deleteUser({ body: { password: 'password123' }, headers: student.headers })

      const [gone] = await db.select({ id: user.id }).from(user).where(eq(user.id, student.userId)).limit(1)
      expect(gone).toBeUndefined()

      const memberships = await db.select({ id: member.id }).from(member).where(eq(member.userId, student.userId))
      expect(memberships).toEqual([])

      // The point of the FK-free audit columns: the school can still see what
      // happened to the member who disappeared from its roster.
      const feed = await listOrgAudit(school.orgId)
      const entry = feed.entries.find(row => row.action === 'member.account_deleted')
      expect(entry).toBeDefined()
      expect(entry!.data).toMatchObject({ targetName: 'Ola Leaver', role: 'student' })
    })

    it('rejects a wrong password before touching anything', async () => {
      const person = await signUp({ email: uniqueEmail('wrongpw') })

      await expect(auth.api.deleteUser({
        body: { password: 'not-my-password' },
        headers: person.headers
      })).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })

      const [stillThere] = await db.select({ id: user.id }).from(user).where(eq(user.id, person.userId)).limit(1)
      expect(stillThere).toBeDefined()
    })
  })
})
