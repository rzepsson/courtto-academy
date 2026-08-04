// Product-neutral audit-log action keys — stable machine identifiers. The client
// renders `audit.actions.<key>` with the entry's `data` interpolated (rule 5:
// never store localized text). Core, so the future Courtto admin panel reuses it.
// Kept free of Nuxt/Node imports (the shared/ rule).
export const AUDIT_ACTIONS = [
  'member.role_changed',
  'member.suspended',
  'member.archived',
  'member.reactivated',
  'member.coach_granted',
  'member.coach_revoked',
  'member.removed',
  'member.ownership_transferred',
  // Self-service account deletion (RODO art. 17). Recorded in EVERY school the
  // person belonged to, before the cascade removes their membership: otherwise a
  // student simply vanishes from the roster with nothing to explain the hole. The
  // denormalized, FK-free actor/target columns are what make this survive.
  'member.account_deleted',
  // Consent (RODO/GDPR): the trail IS the art. 7(1) evidence that a consent was
  // given and when it was withdrawn — the consent row only holds current state.
  'member.consent_granted',
  'member.consent_withdrawn'
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}
