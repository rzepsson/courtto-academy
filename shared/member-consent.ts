// Consent domain (RODO/GDPR) — pure, no Nuxt/Node imports (the shared/ rule).
// CORE, like guardians: it describes a person's decisions, not a lesson.
//
// WHAT BELONGS HERE, AND WHY SO LITTLE:
// Only purposes that are *genuinely* consent-based. Running the lessons a family
// signed up for is processed on the basis of the CONTRACT (GDPR art. 6(1)(b)) —
// not consent. Modelling a "data processing consent" would be a legal error with
// teeth: consent is withdrawable at will (art. 7(3)), so a withdrawal would have
// to stop the service mid-term. Asking for consent you can't honour withdrawing
// is worse than not asking. Hence exactly two types below.
export const CONSENT_TYPES = ['image', 'marketing'] as const
export type ConsentType = (typeof CONSENT_TYPES)[number]

export function isConsentType(value: string): value is ConsentType {
  return (CONSENT_TYPES as readonly string[]).includes(value)
}

// The stored decision. Withdrawal keeps the row (and its grantedAt): erasing it
// would destroy the very evidence art. 7(1) requires — that consent once existed,
// and until when the processing was lawful.
export const CONSENT_DECISIONS = ['granted', 'withdrawn'] as const
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number]

export function isConsentDecision(value: string): value is ConsentDecision {
  return (CONSENT_DECISIONS as readonly string[]).includes(value)
}

// What the school sees. `unknown` (no row at all) is deliberately NOT folded into
// `withdrawn`: both mean "you may not", but they are different jobs — `unknown` is
// paperwork to chase, `withdrawn` is a decision to respect and never re-ask
// casually. Collapsing them would quietly turn "we forgot to ask" into "they said
// no", and lose the only actionable one.
export const CONSENT_STATES = ['unknown', 'granted', 'withdrawn'] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

export function consentState(record: { status: string } | null | undefined): ConsentState {
  if (!record) {
    return 'unknown'
  }
  return isConsentDecision(record.status) ? record.status : 'unknown'
}

// The only question the rest of the app should ask. Silence is never permission:
// under GDPR, absent consent means NO — so anything but an explicit `granted`
// blocks the use.
export function mayUse(state: ConsentState): boolean {
  return state === 'granted'
}

export const CONSENT_LIMITS = {
  documentVersion: 64,
  notes: 500,
  grantedByName: 160
} as const
