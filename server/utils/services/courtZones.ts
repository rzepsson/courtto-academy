import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, isNull, max } from 'drizzle-orm'
import { db } from '../db'
import { court, courtZone } from '../../database/app-schema'
import type { CourtZoneDto } from '../../database/types'
import { courtZoneSchema } from '../../../shared/court-zone-schema'
import { pgErrorCode } from '../pgError'

// Court zones (facility areas/halls) service. App-owned facility-core — written
// with Drizzle directly (rule 4 is scoped to Better-Auth tables). Every query is
// scoped by organizationId, never id alone (multi-tenant isolation). A zone's
// name is case-insensitively unique per facility (partial unique index → 409).

const zoneSchema = courtZoneSchema(code => code)

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

function conflict(message: string, code: string): never {
  throw createError({ statusCode: 409, statusMessage: message, data: { code } })
}

function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505'
}

// Whether a zone id belongs to this facility — the court service's referential
// check before it stores a court.zoneId (so a court can't point at a foreign zone).
export async function zoneBelongsToOrg(organizationId: string, zoneId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: courtZone.id })
    .from(courtZone)
    .where(and(eq(courtZone.organizationId, organizationId), eq(courtZone.id, zoneId)))
    .limit(1)
  return Boolean(row)
}

// The facility's zones in display order, each with its ACTIVE court count (the
// join condition excludes archived courts, so the badge matches the roster).
export async function listZones(organizationId: string): Promise<CourtZoneDto[]> {
  return db
    .select({
      id: courtZone.id,
      name: courtZone.name,
      sortOrder: courtZone.sortOrder,
      courtCount: count(court.id)
    })
    .from(courtZone)
    .leftJoin(court, and(eq(court.zoneId, courtZone.id), isNull(court.archivedAt)))
    .where(eq(courtZone.organizationId, organizationId))
    .groupBy(courtZone.id)
    .orderBy(asc(courtZone.sortOrder))
}

async function activeCourtCount(organizationId: string, zoneId: string): Promise<number> {
  const [row] = await db
    .select({ n: count(court.id) })
    .from(court)
    .where(and(eq(court.organizationId, organizationId), eq(court.zoneId, zoneId), isNull(court.archivedAt)))
  return row?.n ?? 0
}

export async function createZone(organizationId: string, body: unknown, userId: string): Promise<CourtZoneDto> {
  const parsed = zoneSchema.safeParse(body)
  if (!parsed.success) bad('Invalid zone', 'INVALID_ZONE')
  const { name } = parsed.data

  const [agg] = await db
    .select({ max: max(courtZone.sortOrder) })
    .from(courtZone)
    .where(eq(courtZone.organizationId, organizationId))
  const sortOrder = (agg?.max ?? -1) + 1

  const id = randomUUID()
  try {
    await db.insert(courtZone).values({ id, organizationId, name, sortOrder, createdBy: userId })
  } catch (error) {
    if (isUniqueViolation(error)) conflict('Zone name already exists', 'COURT_ZONE_NAME_TAKEN')
    throw error
  }
  return { id, name, sortOrder, courtCount: 0 }
}

// Rename a zone. Null when the id isn't this facility's.
export async function updateZone(organizationId: string, zoneId: string, body: unknown): Promise<CourtZoneDto | null> {
  const parsed = zoneSchema.safeParse(body)
  if (!parsed.success) bad('Invalid zone', 'INVALID_ZONE')

  try {
    const [row] = await db
      .update(courtZone)
      .set({ name: parsed.data.name })
      .where(and(eq(courtZone.organizationId, organizationId), eq(courtZone.id, zoneId)))
      .returning({ id: courtZone.id, name: courtZone.name, sortOrder: courtZone.sortOrder })
    if (!row) return null
    return { ...row, courtCount: await activeCourtCount(organizationId, zoneId) }
  } catch (error) {
    if (isUniqueViolation(error)) conflict('Zone name already exists', 'COURT_ZONE_NAME_TAKEN')
    throw error
  }
}

// Persist a drag-reorder: sortOrder becomes the index in `orderedIds`. Scoped by
// org, so an id not belonging to this facility is a silent no-op. Returns the
// fresh, ordered list.
export async function reorderZones(organizationId: string, orderedIds: string[]): Promise<CourtZoneDto[]> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(courtZone)
        .set({ sortOrder: i })
        .where(and(eq(courtZone.organizationId, organizationId), eq(courtZone.id, orderedIds[i]!)))
    }
  })
  return listZones(organizationId)
}

// Delete a zone. Its courts are UNGROUPED (court.zoneId FK is set null), never
// deleted. Returns false when the id isn't this facility's. Scoped by org.
export async function deleteZone(organizationId: string, zoneId: string): Promise<boolean> {
  const deleted = await db
    .delete(courtZone)
    .where(and(eq(courtZone.organizationId, organizationId), eq(courtZone.id, zoneId)))
    .returning({ id: courtZone.id })
  return deleted.length > 0
}
