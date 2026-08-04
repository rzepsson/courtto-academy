import { randomUUID } from 'node:crypto'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { db } from '../db'
import { auditLog } from '../../database/app-schema'
import type { AuditEntryDto, AuditFeedResult } from '../../database/types'
import type { AuditAction } from '../../../shared/audit'
import { captureError } from '../monitoring'

// The governance audit trail (app-owned, product-neutral core). Append-only:
// recordAudit only inserts, reads only select. Every read is scoped by
// organizationId (tenant isolation, mirrored by the server tests).

// The client-facing projection — org id is never exposed.
const AUDIT_COLUMNS = {
  id: auditLog.id,
  action: auditLog.action,
  actorMemberId: auditLog.actorMemberId,
  targetMemberId: auditLog.targetMemberId,
  data: auditLog.data,
  createdAt: auditLog.createdAt
}

export const AUDIT_FEED_PAGE_SIZE = 50
const AUDIT_FEED_MAX_PAGE_SIZE = 100

// Record one audit entry. BEST-EFFORT by contract: the action being audited has
// already committed (often through Better Auth in a separate transaction), so a
// failure to write the trail must never surface as a failed governance action —
// we log and swallow. The trail is an enhancement; the action is the truth.
export async function recordAudit(entry: {
  organizationId: string
  action: AuditAction
  actorMemberId?: string | null
  targetMemberId?: string | null
  data?: Record<string, string | number | null>
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: randomUUID(),
      organizationId: entry.organizationId,
      action: entry.action,
      actorMemberId: entry.actorMemberId ?? null,
      targetMemberId: entry.targetMemberId ?? null,
      data: entry.data ?? null
    })
  } catch (error) {
    captureError(error, { scope: 'audit.record', action: entry.action, organizationId: entry.organizationId })
  }
}

// One member's activity timeline, newest first, scoped by org. Display names come
// from the snapshots in `data` (no join), so the trail stays readable — and keeps
// its historical wording — even after the people it names leave the school.
export async function listMemberAudit(
  organizationId: string,
  targetMemberId: string,
  limit = 50
): Promise<AuditEntryDto[]> {
  return db
    .select(AUDIT_COLUMNS)
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.targetMemberId, targetMemberId)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
}

function encodeCursor(row: { createdAt: Date, id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`
}

// Lenient: a malformed or stale cursor is ignored (the feed restarts at the head)
// rather than 400-ing, mirroring parseMemberDirectoryQuery.
function decodeCursor(cursor: string | undefined): { createdAt: Date, id: string } | null {
  if (!cursor) {
    return null
  }
  const [iso, id] = cursor.split('|')
  if (!iso || !id) {
    return null
  }
  const createdAt = new Date(iso)
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id }
}

// The org-wide governance feed, newest first, scoped by org. This is the only
// surface where events about a *removed* member remain visible (their per-member
// timeline is unreachable once the membership is gone), which is exactly what an
// audit trail is for.
export async function listOrgAudit(
  organizationId: string,
  options: { cursor?: string, limit?: number } = {}
): Promise<AuditFeedResult> {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? AUDIT_FEED_PAGE_SIZE), 1),
    AUDIT_FEED_MAX_PAGE_SIZE
  )
  const after = decodeCursor(options.cursor)

  const conditions = [eq(auditLog.organizationId, organizationId)]
  if (after) {
    // Keyset: strictly older than the cursor row, with timestamp ties broken by id
    // (matching the ORDER BY). Expressed with typed column operators rather than a
    // raw `(created_at, id) < (…)` row-value tuple: the tuple form makes the driver
    // guess the bind type for a bare Date and mis-serialize it against this plain
    // `timestamp` column.
    conditions.push(
      or(
        lt(auditLog.createdAt, after.createdAt),
        and(eq(auditLog.createdAt, after.createdAt), lt(auditLog.id, after.id))
      )!
    )
  }

  // Fetch one extra row to learn whether another page exists without a count query.
  const rows = await db
    .select(AUDIT_COLUMNS)
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const entries = hasMore ? rows.slice(0, limit) : rows
  const last = entries[entries.length - 1]

  return { entries, nextCursor: hasMore && last ? encodeCursor(last) : null }
}
