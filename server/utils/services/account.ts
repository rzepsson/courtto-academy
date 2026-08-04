import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
// Explicit imports (no Nuxt auto-imports): this module is reachable from
// server/utils/auth.ts, which the `auth` CLI loads outside of Nuxt.
import { db } from '../db'
import { member, organization, user } from '../../database/schema'
import {
  attendance,
  enrollment,
  lessonSeries,
  lessonSession,
  memberConsent,
  memberGuardian,
  memberProfile,
  notification
} from '../../database/app-schema'
import { recordAudit } from './audit'
import { stopBillingForEnrollments } from './enrollmentBilling'
import { toOrgRole } from './membership'
import { toMemberStatus } from '../../../shared/member-profile'
import type {
  AccountDeletionBlocker,
  AccountExportDto,
  AccountExportMembership
} from '../../database/types'

// The account layer — what a signed-in person may do with their OWN account:
// read a copy of their data (RODO art. 15/20) and close it (art. 17). CORE and
// product-neutral: it knows nothing about lessons as a domain, only that some
// rows point at their memberships.
//
// Every query here is scoped by the caller's user id (or by the member ids that
// resolve from it) — never by an id supplied by the request. This service is the
// one place allowed to read across organizations, because "my data" spans every
// school the person belongs to; that is exactly why the scoping is by user id.

// ─── Data export ─────────────────────────────────────────────────────────────

// DELIBERATELY EXCLUDED from the export: memberProfile.notes/tags and the
// guardian/consent `notes` — the staff-only CRM fields. Two reasons, and the
// second is the one that decides it:
//
//  1. The codebase treats those fields as never visible to the member (see
//     memberProfile) — an instant self-service download that quietly reversed
//     that would be a surprise disclosure of one school's internal assessment.
//  2. For a school's records about its students, the SCHOOL is the controller and
//     Courtto the processor. A full art. 15 request therefore goes to the school,
//     which can weigh third-party rights and any exemption. What this export
//     covers is the account-holder's own data — which is what Courtto holds as
//     controller, and what the person can already see in the app.
//
// The school-side (controller) export/erasure of a student's full record is a
// separate surface, not this one.
export async function exportAccountData(userId: string): Promise<AccountExportDto | null> {
  const [account] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  if (!account) {
    return null
  }

  const membershipRows = await db
    .select({
      memberId: member.id,
      role: member.role,
      joinedAt: member.createdAt,
      orgName: organization.name,
      orgSlug: organization.slug,
      status: memberProfile.status,
      canCoach: memberProfile.canCoach,
      dateOfBirth: memberProfile.dateOfBirth
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))

  const memberIds = membershipRows.map(row => row.memberId)

  // Set-based: one query per record type for ALL of the person's memberships,
  // grouped in memory — not a query per school.
  const [guardians, consents, enrollments, attendanceRows, notifications] = await Promise.all([
    memberIds.length > 0
      ? db
          .select({
            memberId: memberGuardian.memberId,
            name: memberGuardian.name,
            relationship: memberGuardian.relationship,
            phone: memberGuardian.phone,
            email: memberGuardian.email,
            isPrimary: memberGuardian.isPrimary
          })
          .from(memberGuardian)
          .where(inArray(memberGuardian.memberId, memberIds))
          .orderBy(asc(memberGuardian.createdAt))
      : [],
    memberIds.length > 0
      ? db
          .select({
            memberId: memberConsent.memberId,
            type: memberConsent.type,
            status: memberConsent.status,
            grantedAt: memberConsent.grantedAt,
            withdrawnAt: memberConsent.withdrawnAt,
            grantedByName: memberConsent.grantedByName,
            documentVersion: memberConsent.documentVersion
          })
          .from(memberConsent)
          .where(inArray(memberConsent.memberId, memberIds))
          .orderBy(asc(memberConsent.type))
      : [],
    memberIds.length > 0 ? selectEnrollments(memberIds) : [],
    memberIds.length > 0
      ? db
          .select({
            memberId: attendance.studentMemberId,
            status: attendance.status,
            markedAt: attendance.markedAt,
            startsAt: lessonSession.startsAt,
            group: lessonSeries.title
          })
          .from(attendance)
          .innerJoin(lessonSession, eq(attendance.sessionId, lessonSession.id))
          .leftJoin(lessonSeries, eq(lessonSession.seriesId, lessonSeries.id))
          .where(inArray(attendance.studentMemberId, memberIds))
          .orderBy(asc(lessonSession.startsAt))
      : [],
    db
      .select({ type: notification.type, createdAt: notification.createdAt, readAt: notification.readAt })
      .from(notification)
      .where(eq(notification.userId, userId))
      .orderBy(asc(notification.createdAt))
  ])

  const memberships: AccountExportMembership[] = membershipRows.map(row => ({
    organization: { name: row.orgName, slug: row.orgSlug },
    role: toOrgRole(row.role),
    status: toMemberStatus(row.status),
    canCoach: row.canCoach ?? false,
    dateOfBirth: row.dateOfBirth ?? null,
    joinedAt: row.joinedAt,
    guardians: guardians
      .filter(item => item.memberId === row.memberId)
      .map(({ memberId: _memberId, ...guardian }) => guardian),
    consents: consents
      .filter(item => item.memberId === row.memberId)
      .map(({ memberId: _memberId, ...consent }) => consent),
    enrollments: enrollments
      .filter(item => item.memberId === row.memberId)
      .map(item => ({
        group: item.seriesTitle ?? item.dropInSeriesTitle ?? null,
        status: item.status,
        waitlistPos: item.waitlistPos,
        enrolledAt: item.enrolledAt
      })),
    attendance: attendanceRows
      .filter(item => item.memberId === row.memberId)
      .map(({ memberId: _memberId, ...record }) => record)
  }))

  return { exportedAt: new Date(), account, memberships, notifications }
}

// An enrolment targets a series XOR a single session (drop-in), so the group name
// comes from one of two joins — the second needs an alias of the same table.
function selectEnrollments(memberIds: string[]) {
  const dropInSeries = alias(lessonSeries, 'drop_in_series')

  return db
    .select({
      memberId: enrollment.studentMemberId,
      status: enrollment.status,
      waitlistPos: enrollment.waitlistPos,
      enrolledAt: enrollment.createdAt,
      seriesTitle: lessonSeries.title,
      dropInSeriesTitle: dropInSeries.title
    })
    .from(enrollment)
    .leftJoin(lessonSeries, eq(enrollment.seriesId, lessonSeries.id))
    .leftJoin(lessonSession, eq(enrollment.sessionId, lessonSession.id))
    .leftJoin(dropInSeries, eq(lessonSession.seriesId, dropInSeries.id))
    .where(inArray(enrollment.studentMemberId, memberIds))
    .orderBy(asc(enrollment.createdAt))
}

// ─── Deletion ────────────────────────────────────────────────────────────────

// Why this account can't be closed yet, or null when nothing blocks it.
//
// A school must never lose its last owner: `member.userId` cascades on the user
// row, so deleting the sole owner would strip the school of the one role that can
// manage members, billing and ownership — with no way back in. Same lockout
// reasoning as the ownership-transfer guard and the owner-status guard; the fix is
// the same too (transfer ownership, or delete the school first).
//
// Returned rather than thrown so the rule is testable without catching, and so the
// Better Auth boundary owns the error shape.
export async function findAccountDeletionBlocker(userId: string): Promise<AccountDeletionBlocker | null> {
  const owned = await db
    .select({ organizationId: member.organizationId, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))

  if (owned.length === 0) {
    return null
  }

  const ownerCounts = await db
    .select({ organizationId: member.organizationId, owners: count() })
    .from(member)
    .where(and(
      inArray(member.organizationId, owned.map(row => row.organizationId)),
      eq(member.role, 'owner')
    ))
    .groupBy(member.organizationId)

  const byOrg = new Map(ownerCounts.map(row => [row.organizationId, Number(row.owners)]))
  // Missing count can't happen (the user is an owner there), but default to 1 —
  // the conservative side is to block, never to strand a school.
  const stranded = owned.find(row => (byOrg.get(row.organizationId) ?? 1) <= 1)

  return stranded ? { code: 'ACCOUNT_OWNS_SCHOOL', organizationName: stranded.name } : null
}

// Everything that must happen BEFORE the user row goes away, in this order.
//
// ORDER IS THE SAFETY PROPERTY, exactly as in purgeSeries: deleting the user
// cascades `member` → `enrollment` → `enrollment_billing`, which is where the
// Stripe subscription id lives. Stop the money first or it can never be stopped —
// the family would be charged monthly for a spot that no longer exists, with no
// record of the subscription anywhere in the database.
//
// Both steps are best-effort by contract (`stopBillingForEnrollments` swallows and
// captures; `recordAudit` likewise), so a Stripe outage or a failed trail write
// never blocks a person from closing their account. The residual risk runs the
// other way — billing stopped for a deletion that then failed — which is
// recoverable (staff resends a payment link) and visible in the money-audit trail,
// whereas an unstoppable subscription is not.
export async function prepareAccountDeletion(userId: string, userName: string | null): Promise<void> {
  const memberships = await db
    .select({ id: member.id, organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))

  if (memberships.length === 0) {
    return
  }

  const memberIds = memberships.map(row => row.id)
  const enrollments = await db
    .select({ id: enrollment.id, studentMemberId: enrollment.studentMemberId })
    .from(enrollment)
    .where(inArray(enrollment.studentMemberId, memberIds))

  for (const membership of memberships) {
    const enrollmentIds = enrollments
      .filter(row => row.studentMemberId === membership.id)
      .map(row => row.id)

    await stopBillingForEnrollments(membership.organizationId, enrollmentIds, {
      memberId: membership.id,
      name: userName
    })

    // The person is both actor and target: they closed their own account. Recorded
    // per school so each roster keeps an explanation for the member who vanished.
    await recordAudit({
      organizationId: membership.organizationId,
      action: 'member.account_deleted',
      actorMemberId: membership.id,
      targetMemberId: membership.id,
      data: { targetName: userName, role: toOrgRole(membership.role) }
    })
  }
}
