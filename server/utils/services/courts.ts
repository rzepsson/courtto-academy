import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, max } from 'drizzle-orm'
import { db } from '../db'
import { court } from '../../database/app-schema'
import type { CourtDto } from '../../database/types'
import type { Sport } from '../../../shared/org-profile'
import { DEFAULT_SURFACE_COLOR, isCourtSport, isValidSurfaceFor } from '../../../shared/courts'
import { courtCreateSchema, courtPatchSchema } from '../../../shared/courts-schema'
import { pgErrorCode } from '../pgError'
import { getOrgProfile } from './orgProfile'

// Court is app-owned (facility core), so this service writes it with Drizzle
// directly (rule 4 is scoped to Better-Auth tables). Every query is scoped by
// organizationId — never by id alone — so one facility can never read or mutate
// another's courts (multi-tenant isolation, mirrored by the server tests).
//
// Field formats/enums/colours/lengths are validated by the shared Zod schema
// (shared/courts-schema.ts — the same one the builder form binds to). Two
// context-dependent rules stay here: the discipline must be one the facility
// offers, and the surface must be valid for the effective sport.

// The client-facing projection: org id and audit columns (createdBy) are never
// exposed. Matches CourtDto.
const COURT_COLUMNS = {
  id: court.id,
  name: court.name,
  sport: court.sport,
  surface: court.surface,
  environment: court.environment,
  status: court.status,
  surfaceColor: court.surfaceColor,
  lineColor: court.lineColor,
  zone: court.zone,
  bookable: court.bookable,
  notes: court.notes,
  sortOrder: court.sortOrder,
  archivedAt: court.archivedAt,
  createdAt: court.createdAt
}

// Built once with the identity resolver: a validation failure here is
// defense-in-depth behind the form, so the raw code (never user-facing) is enough.
const createSchema = courtCreateSchema(code => code)
const patchSchema = courtPatchSchema(code => code)

function bad(message: string, code?: string): never {
  throw createError({ statusCode: 400, statusMessage: message, ...(code ? { data: { code } } : {}) })
}

function conflict(message: string, code: string): never {
  throw createError({ statusCode: 409, statusMessage: message, data: { code } })
}

// Postgres unique_violation — raised by the partial unique index when a second
// active court reuses a (case-insensitive) name within the facility. Uses
// pgErrorCode so it survives Drizzle wrapping the PostgresError in `.cause`.
function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505'
}

// A court's sport must be one the facility actually offers (orgProfile.sports).
// Defense-in-depth: the builder only shows offered sports, but we never trust
// the client — a sport outside the offer is rejected here.
async function requireOfferedSport(organizationId: string, sport: string): Promise<Sport> {
  if (!isCourtSport(sport)) {
    bad('Invalid sport')
  }
  const { sports } = await getOrgProfile(organizationId)
  if (!(sports ?? []).includes(sport)) {
    bad('Sport not offered by this facility', 'COURT_SPORT_NOT_OFFERED')
  }
  return sport
}

export async function listCourts(
  organizationId: string,
  options: { includeArchived?: boolean } = {}
): Promise<CourtDto[]> {
  const where = options.includeArchived
    ? eq(court.organizationId, organizationId)
    : and(eq(court.organizationId, organizationId), isNull(court.archivedAt))

  return db
    .select(COURT_COLUMNS)
    .from(court)
    .where(where)
    .orderBy(asc(court.sortOrder), asc(court.name))
}

// Scoped by (org, id) — returns archived courts too, so an admin can view/restore
// one. Null when the id doesn't belong to this facility.
export async function getCourt(organizationId: string, courtId: string): Promise<CourtDto | null> {
  const [row] = await db
    .select(COURT_COLUMNS)
    .from(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
    .limit(1)

  return row ?? null
}

export async function createCourt(
  organizationId: string,
  body: unknown,
  userId: string
): Promise<CourtDto> {
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid court', 'INVALID_COURT')
  }
  const values = parsed.data

  const sport = await requireOfferedSport(organizationId, values.sport)
  if (values.surface && !isValidSurfaceFor(sport, values.surface)) {
    bad('Invalid surface for this sport')
  }

  // Append to the end of the active roster.
  const [agg] = await db
    .select({ max: max(court.sortOrder) })
    .from(court)
    .where(and(eq(court.organizationId, organizationId), isNull(court.archivedAt)))
  const nextSort = (agg?.max ?? -1) + 1

  try {
    const [created] = await db
      .insert(court)
      .values({
        id: randomUUID(),
        organizationId,
        name: values.name,
        sport,
        surface: values.surface ?? null,
        environment: values.environment ?? 'indoor',
        status: values.status ?? 'active',
        surfaceColor: values.surfaceColor ?? DEFAULT_SURFACE_COLOR[sport],
        lineColor: values.lineColor ?? '#ffffff',
        sortOrder: nextSort,
        zone: values.zone ?? null,
        notes: values.notes ?? null,
        createdBy: userId
      })
      .returning(COURT_COLUMNS)

    return created!
  } catch (error) {
    if (isUniqueViolation(error)) conflict('Court name already exists', 'COURT_NAME_TAKEN')
    throw error
  }
}

export async function updateCourt(
  organizationId: string,
  courtId: string,
  body: unknown
): Promise<CourtDto | null> {
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid court', 'INVALID_COURT')
  }
  const values = parsed.data

  const existing = await getCourt(organizationId, courtId)
  if (!existing) {
    return null
  }

  // Sport may change (still must be offered); otherwise keep the stored one so
  // surface validation has an effective sport to check against.
  let sport = existing.sport as Sport
  const sportChanged = values.sport !== undefined
  if (sportChanged && values.sport) {
    sport = await requireOfferedSport(organizationId, values.sport)
  }

  if (values.surface && !isValidSurfaceFor(sport, values.surface)) {
    bad('Invalid surface for this sport')
  }

  // Assemble only the keys actually present in the body.
  const set: Partial<typeof court.$inferInsert> = {}
  if (values.name !== undefined) set.name = values.name
  if (values.environment !== undefined) set.environment = values.environment
  if (values.status !== undefined) set.status = values.status
  if (values.surfaceColor !== undefined) set.surfaceColor = values.surfaceColor
  if (values.lineColor !== undefined) set.lineColor = values.lineColor
  if (values.surface !== undefined) set.surface = values.surface
  if (values.zone !== undefined) set.zone = values.zone
  if (values.notes !== undefined) set.notes = values.notes

  if (sportChanged && sport !== existing.sport) {
    set.sport = sport
    // A stored surface may no longer be valid for the new sport; drop it unless
    // this request already sets a (validated) surface.
    if (values.surface === undefined && existing.surface && !isValidSurfaceFor(sport, existing.surface)) {
      set.surface = null
    }
  }

  if (Object.keys(set).length === 0) {
    return existing
  }

  try {
    const [updated] = await db
      .update(court)
      .set(set)
      .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
      .returning(COURT_COLUMNS)

    return updated ?? null
  } catch (error) {
    if (isUniqueViolation(error)) conflict('Court name already exists', 'COURT_NAME_TAKEN')
    throw error
  }
}

// Soft-delete: keeps the row (schedule/booking history stays valid) but drops it
// from the active roster. Frees the name for reuse (the unique index exempts
// archived rows). Null when the id isn't an active court of this facility.
export async function archiveCourt(organizationId: string, courtId: string): Promise<CourtDto | null> {
  const [row] = await db
    .update(court)
    .set({ archivedAt: new Date() })
    .where(and(
      eq(court.organizationId, organizationId),
      eq(court.id, courtId),
      isNull(court.archivedAt)
    ))
    .returning(COURT_COLUMNS)

  return row ?? null
}

export async function restoreCourt(organizationId: string, courtId: string): Promise<CourtDto | null> {
  try {
    const [row] = await db
      .update(court)
      .set({ archivedAt: null })
      .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
      .returning(COURT_COLUMNS)

    return row ?? null
  } catch (error) {
    // The name may have been reused by another court while this one was archived.
    if (isUniqueViolation(error)) conflict('Court name already exists', 'COURT_NAME_TAKEN')
    throw error
  }
}

// Hard-delete: permanently removes the row (and, once they exist, cascades to
// its schedule/booking/group links via their FKs). Irreversible — the UI guards
// it behind an explicit warning. Scoped by org; null when the id isn't this
// facility's. Distinct from archiveCourt, which keeps the row for history.
export async function deleteCourt(organizationId: string, courtId: string): Promise<CourtDto | null> {
  const [row] = await db
    .delete(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.id, courtId)))
    .returning(COURT_COLUMNS)

  return row ?? null
}

// Persist a drag-reorder: sortOrder becomes the index in `orderedIds`. Scoped by
// org, so any id not belonging to this facility is a silent no-op (never touches
// another tenant). Returns the fresh active roster.
export async function reorderCourts(organizationId: string, orderedIds: string[]): Promise<CourtDto[]> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(court)
        .set({ sortOrder: i })
        .where(and(eq(court.organizationId, organizationId), eq(court.id, orderedIds[i]!)))
    }
  })

  return listCourts(organizationId)
}
