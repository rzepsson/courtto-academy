import type { NotificationFeed } from '../../database/types'

// The current user's notification feed (newest first) plus the unread count,
// scoped to their active org + account-level items.
export default defineEventHandler(async (event): Promise<NotificationFeed> => {
  const { userId, activeOrgId } = await getActiveScope(event)
  return getNotificationFeed(userId, activeOrgId)
})
