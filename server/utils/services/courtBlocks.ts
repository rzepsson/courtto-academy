import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm'
import { db } from '../db'
import { court, lessonSession, reservation } from '../../database/app-schema'
import type { ReservationDto } from '../../database/types'
import { localDateTimeToInstant } from '../../../shared/schedule'
import {
  COURT_BLOCK_KINDS,
  type CourtBlockKind,
  isCourtBlockKind,
  rangesOverlap
} from '../../../shared/reservation'
import { courtBlockCreateSchema } from '../../../shared/court-block-schema'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import { pgErrorCode } from '../pgError'
import { getOrgProfile } from './orgProfile'

// Court blocks (maintenance windows / closures) service. A block is a standalone
// core `reservation` (no Academy lesson attached) — facility-CORE occupancy, so
// this references nothing Academy. Taking a court out of service is just writing
// a reservation the kind-agnostic court-overlap EXCLUDE then enforces against
// lessons. App-owned table → Drizzle directly (rule 4 is scoped to Better-Auth
// tables). Every query is scoped by organizationId — never id alone.

const RESERVATION_DTO = {
  id: reservation.id,
  courtId: reservation.courtId,
  startsAt: reservation.startsAt,
  endsAt: reservation.endsAt,
  status: reservation.status,
  kind: reservation.kind,
  title: reservation.title,
  note: reservation.note,
  createdAt: reservation.createdAt
}

const blockSchema = courtBlockCreateSchema(code => code)

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

function conflict(message: string, code: string, data: Record<string, string> = {}): never {
  throw createError({ statusCode: 409, statusMessage: message, data: { code, ...data } })
}

// The reservation table has exactly one exclusion constraint (the court-overlap
// EXCLUDE), so any 23P01 here is a court double-book. This is the race-safe
// backstop behind the friendly pre-check below.
function courtOverlapViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23P01'
}

// A block's court must belong to this facility and still be on the active roster
// (you don't block a retired court). Returns nothing — throws on failure.
async function requireActiveCourt(organizationId: string, courtId: string): Promise<void> {
  const [row] = await db
    .select({ id: court.id, archivedAt: court.archivedAt })
    .from(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
    .limit(1)
  if (!row || row.archivedAt) bad('Court not found', 'COURT_BLOCK_COURT_NOT_FOUND')
}

// Friendly pre-check: reject if the range overlaps any existing non-cancelled
// reservation (a lesson OR another block) on the same court. The EXCLUDE is the
// authoritative, race-safe guarantee; this just yields a specific 409.
async function assertCourtFree(organizationId: string, courtId: string, startsAt: Date, endsAt: Date): Promise<void> {
  const existing = await db
    .select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
    .from(reservation)
    .where(and(
      eq(reservation.organizationId, organizationId),
      eq(reservation.courtId, courtId),
      ne(reservation.status, 'cancelled'),
      lt(reservation.startsAt, endsAt),
      gt(reservation.endsAt, startsAt)
    ))
  for (const r of existing) {
    if (rangesOverlap(startsAt, endsAt, r.startsAt, r.endsAt)) {
      conflict('Court is already booked in this window', 'COURT_BLOCK_CONFLICT')
    }
  }
}

// Create a maintenance/closure block on a court. Wall-clock inputs are resolved
// to absolute instants in the facility's timezone (snapshotted like the schedule
// does), so a block honours the same zone as the lessons it guards.
export async function createCourtBlock(
  organizationId: string,
  courtId: string,
  body: unknown,
  userId: string
): Promise<ReservationDto> {
  const parsed = blockSchema.safeParse(body)
  if (!parsed.success) bad('Invalid block', 'COURT_BLOCK_INVALID')
  const values = parsed.data

  await requireActiveCourt(organizationId, courtId)

  const profile = await getOrgProfile(organizationId)
  const timezone = profile.timezone ?? REGIONAL_FALLBACK.timezone
  const startsAt = localDateTimeToInstant(values.startLocal, timezone)
  const endsAt = localDateTimeToInstant(values.endLocal, timezone)
  // Re-check ordering on the resolved instants: a DST forward-jump could collapse
  // a range the wall-clock strings ordered correctly. The DB CHECK backstops it.
  if (endsAt.getTime() <= startsAt.getTime()) bad('Block must end after it starts', 'COURT_BLOCK_RANGE')

  await assertCourtFree(organizationId, courtId, startsAt, endsAt)

  const kind: CourtBlockKind = values.kind && isCourtBlockKind(values.kind) ? values.kind : 'maintenance'
  const id = randomUUID()
  try {
    await db.insert(reservation).values({
      id,
      organizationId,
      courtId,
      startsAt,
      endsAt,
      status: 'confirmed',
      kind,
      title: values.title ?? null,
      createdBy: userId
    })
  } catch (error) {
    if (courtOverlapViolation(error)) conflict('Court is already booked in this window', 'COURT_BLOCK_CONFLICT')
    throw error
  }

  return (await getCourtBlock(organizationId, id))!
}

async function getCourtBlock(organizationId: string, id: string): Promise<ReservationDto | null> {
  const [row] = await db
    .select(RESERVATION_DTO)
    .from(reservation)
    .where(and(eq(reservation.organizationId, organizationId), eq(reservation.id, id)))
    .limit(1)
  return row ?? null
}

// Non-cancelled court blocks (maintenance/closure reservations, never lessons)
// overlapping [from, to). The calendar overlays these so an admin sees why a
// court can't be booked. Scoped by org.
export async function listCourtBlocks(
  organizationId: string,
  range: { from: Date, to: Date, courtId?: string }
): Promise<ReservationDto[]> {
  return db
    .select(RESERVATION_DTO)
    .from(reservation)
    .where(and(
      eq(reservation.organizationId, organizationId),
      inArray(reservation.kind, [...COURT_BLOCK_KINDS]),
      ne(reservation.status, 'cancelled'),
      lt(reservation.startsAt, range.to),
      gt(reservation.endsAt, range.from),
      ...(range.courtId ? [eq(reservation.courtId, range.courtId)] : [])
    ))
    .orderBy(asc(reservation.startsAt))
}

// Permanently remove a block. Scoped by org AND constrained to the block kinds,
// so this can never delete a lesson's reservation (which would orphan a session).
// A belt-and-braces guard also refuses if any lesson_session points at the row.
// Returns false when nothing matched (wrong tenant / already gone / not a block).
export async function deleteCourtBlock(organizationId: string, id: string): Promise<boolean> {
  const [attached] = await db
    .select({ id: lessonSession.id })
    .from(lessonSession)
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.reservationId, id)))
    .limit(1)
  if (attached) return false

  const deleted = await db
    .delete(reservation)
    .where(and(
      eq(reservation.organizationId, organizationId),
      eq(reservation.id, id),
      inArray(reservation.kind, [...COURT_BLOCK_KINDS])
    ))
    .returning({ id: reservation.id })
  return deleted.length > 0
}
