// Shared notification vocabulary — the stable machine `type` keys and their
// intrinsic properties. Imported by BOTH the server (which decides dismissible /
// dedupe when creating a row) and the client (which maps a type to an icon and
// to its localized copy). Keep this free of Nuxt/Node imports so it loads in any
// context, including the `auth` CLI (server/utils/auth.ts pulls it in through
// the notifications service used by the organization-created hook).
//
// Localized text is NEVER stored on the row (rule 5): the client renders
// `notifications.types.<type>.{title,body}` with the row's `data` as
// interpolation params, falling back to a generic key for unknown types.

// Types are dot-namespaced (`domain.event`). vue-i18n treats a dot as a path
// separator, so a type maps to a NESTED i18n key: `org.setup_incomplete` →
// `notifications.types.org.setup_incomplete.{title,body}` must be nested objects
// in the locale files (NOT a single flat "org.setup_incomplete" key, which the
// dotted lookup can't reach).
export const NOTIFICATION_TYPES = [
  'org.setup_incomplete',
  // Operational lesson events (dismissible, one row per real event). These are
  // what turn the product into the school's system of record — a cancelled or
  // moved lesson reaches the people it affects instead of a parallel WhatsApp
  // group. Emitted by services/lessonNotifications.ts, which also mails them.
  'lesson.cancelled',
  'lesson.rescheduled',
  'lesson.reminder',
  'enrollment.waitlist_promoted',
  // A student's monthly payment failed (Stripe dunning). Alerts school staff so
  // they can follow up; the payer gets Stripe's own dunning email separately.
  'billing.payment_failed'
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// System-managed types: the user can't manually dismiss them (no `x`, skipped by
// "clear all"). Their lifecycle is owned by the system — created and resolved by
// a condition, never by a click. Each also gets a stable dedupe key so the row
// is created at most once per (user, org). The lesson events above are ordinary
// dismissible notifications — they mark a real event, not a live condition.
export const SYSTEM_NOTIFICATION_TYPES: readonly NotificationType[] = ['org.setup_incomplete']

export function isSystemNotificationType(type: string): boolean {
  return (SYSTEM_NOTIFICATION_TYPES as readonly string[]).includes(type)
}

export function isKnownNotificationType(type: string): type is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(type)
}
