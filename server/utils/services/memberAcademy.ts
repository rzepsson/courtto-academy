import { and, eq, gte, lt } from 'drizzle-orm'
import { db } from '../db'
import { attendance, lessonSession } from '../../database/app-schema'
import type {
  MemberAcademyDto,
  MemberAcademyGroup,
  MemberAcademyLearning,
  MemberAcademyLoad,
  ScheduleSessionDto
} from '../../database/types'
import { canMemberCoach } from '../../../shared/member-profile'
import { attendanceRate, EMPTY_ATTENDANCE, type AttendanceTally } from '../../../shared/member-academy'
import { clampedMinutes, computeIntervalLoad } from '../../../shared/utilization'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import { getMemberDetail } from './memberProfile'
import { getOrgProfile } from './orgProfile'
import { listSessions } from './schedule'
import { listStudentSessions } from './enrollment'

// ACADEMY people-analytics: what a member actually does in the school — hours
// taught or trained, and in which groups. This sits strictly ON TOP of the core:
// it reads the member sidecar's capability + the Academy lesson tables, and the
// core never references it back. Composition only — the time math is the shared,
// unit-tested `computeIntervalLoad` (the same engine court utilization uses), so
// a person's heatmap and a court's heatmap can never drift apart.
//
// Every read is scoped by organizationId (tenant isolation, covered by tests).

// A cancelled occurrence is not time taught or trained, so it never counts toward
// load. (It stays on the calendar — that's a different question.)
function activeSessions<T extends { status: string }>(sessions: T[]): T[] {
  return sessions.filter(session => session.status !== 'cancelled')
}

// Roll sessions up into the groups they belong to, busiest first — the list reads
// top-down by commitment, which is what "which groups is this person in?" means.
function groupBySeries(
  sessions: (ScheduleSessionDto & { enrollmentStatus?: string })[],
  from: Date,
  to: Date
): MemberAcademyGroup[] {
  const groups = new Map<string, MemberAcademyGroup>()

  for (const session of sessions) {
    let group = groups.get(session.seriesId)
    if (!group) {
      group = {
        seriesId: session.seriesId,
        title: session.seriesTitle,
        sport: session.sport,
        type: session.type,
        color: session.color,
        sessionCount: 0,
        minutes: 0,
        enrollmentStatus: session.enrollmentStatus ?? null
      }
      groups.set(session.seriesId, group)
    }
    group.sessionCount += 1
    group.minutes += clampedMinutes(session, from, to)
  }

  return [...groups.values()].sort((a, b) => b.minutes - a.minutes)
}

function toLoad(
  sessions: (ScheduleSessionDto & { enrollmentStatus?: string })[],
  timezone: string,
  from: Date,
  to: Date
): MemberAcademyLoad {
  const load = computeIntervalLoad(sessions, timezone, from, to)
  return {
    minutes: load.minutes,
    sessionCount: load.count,
    heatmap: load.heatmap,
    peakBucket: load.peakBucket,
    groups: groupBySeries(sessions, from, to)
  }
}

// Attendance marked for this student on sessions starting in the window.
async function tallyAttendance(
  organizationId: string,
  studentMemberId: string,
  from: Date,
  to: Date
): Promise<AttendanceTally> {
  const rows = await db
    .select({ status: attendance.status })
    .from(attendance)
    .innerJoin(lessonSession, eq(attendance.sessionId, lessonSession.id))
    .where(and(
      eq(attendance.organizationId, organizationId),
      eq(attendance.studentMemberId, studentMemberId),
      gte(lessonSession.startsAt, from),
      lt(lessonSession.startsAt, to)
    ))

  const tally: AttendanceTally = { ...EMPTY_ATTENDANCE }
  for (const row of rows) {
    if (row.status in tally) {
      tally[row.status as keyof AttendanceTally] += 1
    }
  }
  return tally
}

async function loadTeaching(
  organizationId: string,
  memberId: string,
  timezone: string,
  range: { from: Date, to: Date }
): Promise<MemberAcademyLoad> {
  const sessions = activeSessions(
    await listSessions(organizationId, { from: range.from, to: range.to, coachMemberId: memberId })
  )
  return toLoad(sessions, timezone, range.from, range.to)
}

async function loadLearning(
  organizationId: string,
  memberId: string,
  timezone: string,
  range: { from: Date, to: Date }
): Promise<MemberAcademyLearning> {
  const [sessions, tally] = await Promise.all([
    listStudentSessions(organizationId, memberId, range),
    tallyAttendance(organizationId, memberId, range.from, range.to)
  ])
  return {
    ...toLoad(activeSessions(sessions), timezone, range.from, range.to),
    attendance: tally,
    attendanceRate: attendanceRate(tally)
  }
}

// Null when the id isn't a member of this facility — the handler 404s, never
// leaking another tenant.
export async function getMemberAcademy(
  organizationId: string,
  memberId: string,
  range: { from: Date, to: Date }
): Promise<MemberAcademyDto | null> {
  const member = await getMemberDetail(organizationId, memberId)
  if (!member) {
    return null
  }

  const profile = await getOrgProfile(organizationId)
  const timezone = profile.timezone ?? REGIONAL_FALLBACK.timezone

  // The capability (not the role) decides the teaching lens, so an owner/admin who
  // teaches gets one too — the same rule the pickers and requireCoach use.
  const [teaching, learning] = await Promise.all([
    canMemberCoach(member) ? loadTeaching(organizationId, memberId, timezone, range) : Promise.resolve(null),
    member.role === 'student' ? loadLearning(organizationId, memberId, timezone, range) : Promise.resolve(null)
  ])

  return { from: range.from, to: range.to, timezone, teaching, learning }
}
