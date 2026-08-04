import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, isNull, or, type SQL } from 'drizzle-orm'
// Explicit imports (no Nuxt auto-imports): this module is reachable from
// `server/utils/auth.ts` (the organization-created hook), which the `auth` CLI
// loads outside of Nuxt.
import { db } from '../db'
import { notification } from '../../database/app-schema'
import type { NotificationDto, NotificationFeed, NotificationRow } from '../../database/types'
import { isSystemNotificationType, type NotificationType } from '../../../shared/notifications'
import { publishToUser } from '../realtime'

// Cap the feed — the bell shows recent activity, not an unbounded archive.
const FEED_LIMIT = 50

interface CreateNotificationInput {
  userId: string
  organizationId?: string | null
  type: NotificationType
  data?: Record<string, string | number | null> | null
  link?: string | null
  // Overrides the type's default (system types are non-dismissible).
  dismissible?: boolean
  // Set to make the row a singleton per (user, key); a second create is a no-op.
  dedupeKey?: string | null
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    organizationId: row.organizationId,
    data: row.data,
    link: row.link,
    read: row.readAt !== null,
    dismissible: row.dismissible,
    createdAt: row.createdAt
  }
}

// The bell scopes to the active org plus account-level (org-less) items, so the
// two contexts of a multi-school user never bleed together. When there's no
// active org, only account-level notifications are visible.
function scopeWhere(userId: string, activeOrgId: string | null): SQL {
  const owned = eq(notification.userId, userId)
  const scope = activeOrgId
    ? or(isNull(notification.organizationId), eq(notification.organizationId, activeOrgId))
    : isNull(notification.organizationId)
  return and(owned, scope)!
}

// Returns whether a row was actually inserted (false = deduped no-op). Callers
// that fan out to another channel (e.g. a reminder email) use this to act exactly
// once per (user, dedupeKey), never on a repeat sweep.
export async function createNotification(input: CreateNotificationInput): Promise<boolean> {
  const dismissible = input.dismissible ?? !isSystemNotificationType(input.type)

  const inserted = await db
    .insert(notification)
    .values({
      id: randomUUID(),
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      type: input.type,
      data: input.data ?? null,
      link: input.link ?? null,
      dismissible,
      dedupeKey: input.dedupeKey ?? null
    })
    // Idempotent for singleton notifications (partial unique on user + dedupeKey).
    .onConflictDoNothing()
    .returning({ id: notification.id })

  const created = inserted.length > 0
  // Only signal the client when a row was actually created (a deduped insert is
  // a no-op). REST stays authoritative, so this is a best-effort nudge.
  if (created) {
    publishToUser(input.userId, { event: 'notification' })
  }
  return created
}

export async function getNotificationFeed(userId: string, activeOrgId: string | null): Promise<NotificationFeed> {
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(notification)
      .where(scopeWhere(userId, activeOrgId))
      .orderBy(desc(notification.createdAt))
      .limit(FEED_LIMIT),
    db
      .select({ value: count() })
      .from(notification)
      .where(and(scopeWhere(userId, activeOrgId), isNull(notification.readAt)))
  ])

  return {
    notifications: rows.map(toDto),
    unreadCount: unread?.value ?? 0
  }
}

// Marks every unread notification in the user's current scope as read — the
// "opened the bell" transition that clears the badge.
export async function markScopeRead(userId: string, activeOrgId: string | null): Promise<void> {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(scopeWhere(userId, activeOrgId), isNull(notification.readAt)))
}

// Dismisses a single notification. Guarded to the owner and to dismissible rows,
// so a system notification can never be removed via this path. Returns whether a
// row was actually deleted.
export async function dismissNotification(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(notification)
    .where(and(
      eq(notification.id, id),
      eq(notification.userId, userId),
      eq(notification.dismissible, true)
    ))
    .returning({ id: notification.id })

  return deleted.length > 0
}

// Clears all dismissible notifications in scope (the "clear all" button). System
// notifications are left in place.
export async function clearNotifications(userId: string, activeOrgId: string | null): Promise<void> {
  await db
    .delete(notification)
    .where(and(scopeWhere(userId, activeOrgId), eq(notification.dismissible, true)))
}

// --- Domain events -------------------------------------------------------

// Emitted right after a school is created: nudge the owner to finish the
// essential profile data. Non-dismissible + deduped — it lives until the profile
// is complete, at which point `resolveOrgSetupNotification` removes it.
export async function notifyOrgSetupIncomplete(
  userId: string,
  organizationId: string,
  schoolName: string
): Promise<void> {
  await createNotification({
    userId,
    organizationId,
    type: 'org.setup_incomplete',
    data: { schoolName },
    link: '/school/settings',
    dedupeKey: `org.setup_incomplete:${organizationId}`
  })
}

// Removes the setup notification for an org once its profile is complete. Keyed
// by org + type so it clears the alert for every staff member who holds it.
export async function resolveOrgSetupNotification(organizationId: string): Promise<void> {
  await db
    .delete(notification)
    .where(and(
      eq(notification.organizationId, organizationId),
      eq(notification.type, 'org.setup_incomplete')
    ))
}
