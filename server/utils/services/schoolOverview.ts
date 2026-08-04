import { DateTime } from 'luxon'
import { and, eq, gt, lt, ne } from 'drizzle-orm'
import { db } from '../db'
import { reservation } from '../../database/app-schema'
import type { OverviewSession, SchoolOverviewDto } from '../../database/types'
import { FACILITY_OPERATING_HOURS } from '../../../shared/reservation'
import { computeUtilization } from '../../../shared/utilization'
import { computeProfileCompletion } from '../../../shared/org-profile'
import { canMemberCoach } from '../../../shared/member-profile'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import { getOrgProfile } from './orgProfile'
import { listOrganizationMembers, listPendingInvitations } from './membership'
import { listCourts } from './courts'
import { listSessions } from './schedule'
import { listOrgAudit } from './audit'

// Owner dashboard read — composition-only, product-neutral where it can be (the
// occupancy engine is the shared, tested computeUtilization over CORE reservations).
// Assembles one payload from existing scoped reads so the page makes a single call;
// every read is org-scoped, so there's no tenant leak to add here.

const WEEK_DAYS = 7
const RECENT_ACTIVITY_LIMIT = 6

export async function getSchoolOverview(organizationId: string): Promise<SchoolOverviewDto> {
  const profile = await getOrgProfile(organizationId)
  const timezone = profile.timezone ?? REGIONAL_FALLBACK.timezone

  // Whole-local-day windows in the org timezone: today (the timetable) and the
  // rolling last 7 days (the occupancy heatmap — always a full 7 rows).
  const todayStart = DateTime.now().setZone(timezone).startOf('day')
  const todayEnd = todayStart.plus({ days: 1 })
  const weekFrom = todayEnd.minus({ days: WEEK_DAYS })

  const todayStartJs = todayStart.toJSDate()
  const todayEndJs = todayEnd.toJSDate()
  const weekFromJs = weekFrom.toJSDate()
  const weekToJs = todayEnd.toJSDate()

  const [members, courts, todaySessions, weekReservations, pendingInvitations, audit] = await Promise.all([
    listOrganizationMembers(organizationId),
    listCourts(organizationId, { includeArchived: true }),
    listSessions(organizationId, { from: todayStartJs, to: todayEndJs }),
    db
      .select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt, kind: reservation.kind })
      .from(reservation)
      .where(and(
        eq(reservation.organizationId, organizationId),
        ne(reservation.status, 'cancelled'),
        lt(reservation.startsAt, weekToJs),
        gt(reservation.endsAt, weekFromJs)
      )),
    listPendingInvitations(organizationId),
    listOrgAudit(organizationId, { limit: RECENT_ACTIVITY_LIMIT })
  ])

  // Counts — active only. "Coaches" is the capability (canMemberCoach), so an
  // owner/admin who teaches is counted; "staff" is the governance headcount.
  const activeMembers = members.filter(member => member.status === 'active')
  const counts = {
    students: activeMembers.filter(member => member.role === 'student').length,
    coaches: activeMembers.filter(member => canMemberCoach(member)).length,
    staff: activeMembers.filter(member => member.role === 'owner' || member.role === 'admin').length,
    courts: courts.filter(court => court.archivedAt === null).length
  }

  // Display-name maps (archived courts included so an archived court's name still
  // resolves on a lesson that predates the archive).
  const courtNames = new Map(courts.map(court => [court.id, court.name]))
  const coachNames = new Map(members.map(member => [member.id, member.user.name]))

  const today: OverviewSession[] = todaySessions
    .filter(session => session.status !== 'cancelled' && session.reservationStatus !== 'cancelled')
    .map(session => ({
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      title: session.seriesTitle,
      sport: session.sport,
      color: session.color,
      status: session.status,
      courtName: session.courtId ? courtNames.get(session.courtId) ?? null : null,
      coachName: session.coachMemberId ? coachNames.get(session.coachMemberId) ?? null : null,
      capacityMax: session.capacityMax
    }))

  // Facility-wide occupancy: computeUtilization gives the demand heatmap + totals,
  // but its utilizationPct assumes a single court. Recompute the ratio against the
  // whole active roster's capacity (usage within operating hours ÷ courts × hours).
  const stats = computeUtilization(weekReservations, timezone, FACILITY_OPERATING_HOURS, weekFromJs, weekToJs)
  let inWindowMinutes = 0
  for (let weekday = 0; weekday < WEEK_DAYS; weekday++) {
    for (let hour = FACILITY_OPERATING_HOURS.open; hour < FACILITY_OPERATING_HOURS.close; hour++) {
      inWindowMinutes += stats.heatmap[weekday * 24 + hour] ?? 0
    }
  }
  const openHours = Math.max(0, FACILITY_OPERATING_HOURS.close - FACILITY_OPERATING_HOURS.open)
  const capacityMinutes = openHours * 60 * WEEK_DAYS * counts.courts
  const occupancyPct = capacityMinutes > 0 ? Math.min(100, (inWindowMinutes / capacityMinutes) * 100) : 0

  return {
    timezone,
    counts,
    week: {
      from: weekFromJs,
      to: weekToJs,
      operating: { ...FACILITY_OPERATING_HOURS },
      lessonHours: stats.usageMinutes / 60,
      lessonCount: stats.usageCount,
      occupancyPct,
      heatmap: stats.heatmap,
      peakBucket: stats.peakBucket
    },
    today: { date: todayStartJs, sessions: today },
    attention: {
      profileMissing: computeProfileCompletion(profile).missing,
      pendingInvitations: pendingInvitations.length
    },
    activity: audit.entries
  }
}
