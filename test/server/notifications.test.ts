import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearNotifications,
  createNotification,
  dismissNotification,
  getNotificationFeed,
  markScopeRead,
  notifyOrgSetupIncomplete,
  resolveOrgSetupNotification
} from '../../server/utils/services/notifications'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'

describe.skipIf(!hasTestDb)('notifications service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  describe('org setup notification (created by the afterCreateOrganization hook)', () => {
    it('creates a non-dismissible setup notification for the owner when a school is created', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })

      const feed = await getNotificationFeed(owner.userId, orgId)

      expect(feed.notifications).toHaveLength(1)
      expect(feed.unreadCount).toBe(1)
      const [notification] = feed.notifications
      expect(notification?.type).toBe('org.setup_incomplete')
      expect(notification?.organizationId).toBe(orgId)
      expect(notification?.dismissible).toBe(false)
      expect(notification?.read).toBe(false)
      expect(notification?.link).toBe('/school/settings')
      expect(notification?.data).toMatchObject({ schoolName: 'Ace' })
    })

    it('is idempotent — a second emit does not duplicate it', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })

      await notifyOrgSetupIncomplete(owner.userId, orgId, 'Ace')

      const feed = await getNotificationFeed(owner.userId, orgId)
      expect(feed.notifications).toHaveLength(1)
    })

    it('cannot be manually dismissed or cleared, but resolves when setup completes', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
      const [notification] = (await getNotificationFeed(owner.userId, orgId)).notifications

      // The dismiss endpoint guards dismissible=true, so this is a no-op.
      expect(await dismissNotification(owner.userId, notification!.id)).toBe(false)
      await clearNotifications(owner.userId, orgId)
      expect((await getNotificationFeed(owner.userId, orgId)).notifications).toHaveLength(1)

      // System-owned lifecycle: resolved by condition, not a click.
      await resolveOrgSetupNotification(orgId)
      expect((await getNotificationFeed(owner.userId, orgId)).notifications).toHaveLength(0)
    })
  })

  describe('scope and read state', () => {
    it('scopes to the active org plus account-level, hiding other orgs', async () => {
      const owner = await signUp()
      const orgA = await createOrg(owner, { name: 'A', slug: 'org-a' })
      const orgB = await createOrg(owner, { name: 'B', slug: 'org-b' })

      // An account-level (org-less) notification is always visible.
      await createNotification({ userId: owner.userId, type: 'org.setup_incomplete', organizationId: null })

      const feedA = await getNotificationFeed(owner.userId, orgA)
      const orgIds = feedA.notifications.map(n => n.organizationId)
      expect(orgIds).toContain(orgA)
      expect(orgIds).toContain(null)
      expect(orgIds).not.toContain(orgB)
    })

    it('returns notifications newest-first', async () => {
      const owner = await signUp()
      await createNotification({ userId: owner.userId, type: 'org.setup_incomplete', data: { n: 1 } })
      await createNotification({ userId: owner.userId, type: 'org.setup_incomplete', data: { n: 2 } })

      const feed = await getNotificationFeed(owner.userId, null)
      expect(feed.notifications.map(n => n.data?.n)).toEqual([2, 1])
    })

    it('markScopeRead clears the unread count for the scope', async () => {
      const owner = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })
      expect((await getNotificationFeed(owner.userId, orgId)).unreadCount).toBe(1)

      await markScopeRead(owner.userId, orgId)

      const feed = await getNotificationFeed(owner.userId, orgId)
      expect(feed.unreadCount).toBe(0)
      expect(feed.notifications[0]?.read).toBe(true)
    })

    it('does not leak one user\'s notifications to another', async () => {
      const owner = await signUp()
      const other = await signUp()
      const orgId = await createOrg(owner, { name: 'Ace', slug: 'ace' })

      expect((await getNotificationFeed(other.userId, orgId)).notifications).toHaveLength(0)
    })
  })

  describe('dismissible notifications', () => {
    it('can be dismissed by their owner and cleared in bulk', async () => {
      const owner = await signUp()
      await createNotification({ userId: owner.userId, type: 'org.setup_incomplete', dismissible: true })
      await createNotification({ userId: owner.userId, type: 'org.setup_incomplete', dismissible: true })

      const feed = await getNotificationFeed(owner.userId, null)
      expect(await dismissNotification(owner.userId, feed.notifications[0]!.id)).toBe(true)
      expect((await getNotificationFeed(owner.userId, null)).notifications).toHaveLength(1)

      await clearNotifications(owner.userId, null)
      expect((await getNotificationFeed(owner.userId, null)).notifications).toHaveLength(0)
    })

    it('a user cannot dismiss another user\'s notification', async () => {
      const owner = await signUp()
      const other = await signUp()
      await createNotification({ userId: owner.userId, type: 'org.setup_incomplete', dismissible: true })
      const feed = await getNotificationFeed(owner.userId, null)

      expect(await dismissNotification(other.userId, feed.notifications[0]!.id)).toBe(false)
      expect((await getNotificationFeed(owner.userId, null)).notifications).toHaveLength(1)
    })
  })
})
