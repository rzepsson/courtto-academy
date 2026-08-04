import { and, count, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { member, user } from '../../database/schema'
import { memberConsent, memberGuardian, memberProfile } from '../../database/app-schema'
import type { ComplianceGapRow, ComplianceReportDto } from '../../database/types'
import { evaluateCompliance, hasComplianceGap } from '../../../shared/compliance'
import { consentState } from '../../../shared/member-consent'
import { calculateAge, isMinor } from '../../../shared/member-guardian'
import { toOrgRole } from './membership'

// Roster-level RODO/GDPR compliance report — CORE (guardians + consents describe a
// person, not a lesson). READs only; every query is scoped by organizationId, so
// one school can never see another's minors or consent records (PII — tenant
// isolation is covered by the server tests).
//
// The classification lives in the pure `evaluateCompliance` (shared/); this service
// only fetches the inputs it needs with set-based queries (no N+1) and maps them.

// The active roster status uses the coalesced sidecar (absent row = 'active'),
// mirroring the member directory so both agree on who's active.
const activeStatusExpr = sql<string>`coalesce(${memberProfile.status}, 'active')`

export async function getComplianceReport(organizationId: string): Promise<ComplianceReportDto> {
  // Population: the ACTIVE STUDENT roster — the people the school is responsible for
  // as participants. A minor is a student; image consent is a student concern.
  // Staff (adults, employment-basis) are deliberately out of scope, so the report
  // is a real work-queue, not noise.
  //
  // One row per student: the (memberId, type) unique index makes the image-consent
  // LEFT JOIN at most 1:1, and the memberProfile join is 1:1.
  const students = await db
    .select({
      memberId: member.id,
      role: member.role,
      dateOfBirth: memberProfile.dateOfBirth,
      imageConsentStatus: memberConsent.status,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .leftJoin(memberConsent, and(
      eq(memberConsent.memberId, member.id),
      eq(memberConsent.organizationId, organizationId),
      eq(memberConsent.type, 'image')
    ))
    .where(and(
      eq(member.organizationId, organizationId),
      eq(member.role, 'student'),
      eq(activeStatusExpr, 'active')
    ))

  // Guardian counts for the whole org in one grouped query, then joined in memory —
  // set-based, so the report stays O(1) queries regardless of roster size.
  const guardianCounts = await db
    .select({ memberId: memberGuardian.memberId, total: count() })
    .from(memberGuardian)
    .where(eq(memberGuardian.organizationId, organizationId))
    .groupBy(memberGuardian.memberId)

  const guardianCountByMember = new Map(
    guardianCounts.map(row => [row.memberId, Number(row.total)])
  )

  let missingGuardian = 0
  let missingImageConsent = 0
  const rows: ComplianceGapRow[] = []

  for (const student of students) {
    const guardianCount = guardianCountByMember.get(student.memberId) ?? 0
    const gaps = evaluateCompliance({
      dateOfBirth: student.dateOfBirth,
      guardianCount,
      imageConsentStatus: student.imageConsentStatus
    })

    if (gaps.missingGuardian) missingGuardian += 1
    if (gaps.missingImageConsent) missingImageConsent += 1
    if (!hasComplianceGap(gaps)) continue

    rows.push({
      memberId: student.memberId,
      role: toOrgRole(student.role),
      age: student.dateOfBirth ? calculateAge(student.dateOfBirth) : null,
      isMinor: isMinor(student.dateOfBirth),
      missingGuardian: gaps.missingGuardian,
      missingImageConsent: gaps.missingImageConsent,
      imageConsentState: consentState(
        student.imageConsentStatus ? { status: student.imageConsentStatus } : null
      ),
      user: {
        id: student.userId,
        name: student.userName,
        email: student.userEmail,
        image: student.userImage
      }
    })
  }

  // Most urgent first: a minor with nobody to call outranks a missing consent;
  // then alphabetical so the list is stable to work through.
  rows.sort((a, b) =>
    Number(b.missingGuardian) - Number(a.missingGuardian)
    || a.user.name.localeCompare(b.user.name)
  )

  return {
    rows,
    summary: {
      studentsConsidered: students.length,
      missingGuardian,
      missingImageConsent,
      withGaps: rows.length
    }
  }
}
