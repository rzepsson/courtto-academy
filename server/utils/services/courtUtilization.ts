import { and, eq, gt, lt, ne } from 'drizzle-orm'
import { db } from '../db'
import { reservation } from '../../database/app-schema'
import type { CourtUtilizationDto } from '../../database/types'
import { FACILITY_OPERATING_HOURS } from '../../../shared/reservation'
import { computeUtilization } from '../../../shared/utilization'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import { getOrgProfile } from './orgProfile'

// Court utilization service — facility-CORE (product-neutral): it reads only the
// core `reservation` primitive (court × time × kind), so it serves Academy today
// and the future Courtto marketplace unchanged. The heavy lifting is the pure
// `computeUtilization` (shared/); this just fetches the rows and resolves the
// timezone. Scoped by organizationId + courtId — never id alone.
export async function getCourtUtilization(
  organizationId: string,
  courtId: string,
  from: Date,
  to: Date
): Promise<CourtUtilizationDto> {
  // Non-cancelled reservations on this court overlapping [from, to). The clamping
  // to the window happens in the pure aggregator.
  const rows = await db
    .select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt, kind: reservation.kind })
    .from(reservation)
    .where(and(
      eq(reservation.organizationId, organizationId),
      eq(reservation.courtId, courtId),
      ne(reservation.status, 'cancelled'),
      lt(reservation.startsAt, to),
      gt(reservation.endsAt, from)
    ))

  const profile = await getOrgProfile(organizationId)
  const timezone = profile.timezone ?? REGIONAL_FALLBACK.timezone

  const stats = computeUtilization(rows, timezone, FACILITY_OPERATING_HOURS, from, to)
  return { from, to, timezone, operating: { ...FACILITY_OPERATING_HOURS }, ...stats }
}
