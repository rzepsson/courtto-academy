import { describe, expect, it } from 'vitest'
import { NOTIFICATION_TYPES, isKnownNotificationType, isSystemNotificationType } from '../../shared/notifications'

describe('notification types', () => {
  it('knows the lesson event types', () => {
    for (const type of ['lesson.cancelled', 'lesson.rescheduled', 'lesson.reminder', 'enrollment.waitlist_promoted']) {
      expect(isKnownNotificationType(type)).toBe(true)
      expect((NOTIFICATION_TYPES as readonly string[]).includes(type)).toBe(true)
    }
    expect(isKnownNotificationType('lesson.imaginary')).toBe(false)
    expect(isKnownNotificationType('billing.payment_failed')).toBe(true)
  })

  it('treats the lesson events as ordinary dismissible notifications (only setup is system-managed)', () => {
    expect(isSystemNotificationType('org.setup_incomplete')).toBe(true)
    for (const type of ['lesson.cancelled', 'lesson.rescheduled', 'lesson.reminder', 'enrollment.waitlist_promoted', 'billing.payment_failed']) {
      expect(isSystemNotificationType(type)).toBe(false)
    }
  })
})
