// Legal-document domain — pure, no Nuxt/Node imports (the shared/ rule), so it
// loads on the client, on the server, and under the `auth` CLI outside Nuxt.
//
// CORE, product-neutral: the future Courtto marketplace needs the same terms +
// privacy acceptance trail, so nothing here mentions schools or lessons.

// The documents a person accepts when creating an account. `terms` is a contract
// they enter into; `privacy` is an information obligation they acknowledge. They
// are versioned together because the registration checkbox covers both.
export const LEGAL_DOCUMENTS = ['terms', 'privacy'] as const
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number]

// THE SINGLE SOURCE OF TRUTH for which version is in force. Bump when the text in
// docs/legal/ changes materially (scope, legal basis, retention, sub-processor,
// liability) — never for a typo. Everything else derives from these two strings:
// the acceptance recorded at sign-up, the version shown on /terms and /privacy,
// and whether an existing user is asked to accept again.
//
// Bumping does NOT notify anyone. Art. 8(3) of the Polish e-services act requires
// informing users of a change to the terms, and for a continuous contract that
// means advance notice plus a right to terminate — a separate, deliberate step.
export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocument, string> = {
  terms: '2026-08-21',
  privacy: '2026-08-20'
}

export function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value)
}

// Consents Courtto collects for ITS OWN purposes, from the holder of an account —
// distinct from `member-consent.ts`, where the SCHOOL is the controller and the
// subject is one of its students.
//
// Exactly one entry, for the same reason member consent has only two: running the
// service someone signed up for is performed on the basis of the CONTRACT
// (art. 6(1)(b)), never consent. A "consent to process my data" checkbox at
// sign-up would be a legal error — withdrawable at will (art. 7(3)), so honouring
// a withdrawal would mean shutting off the account mid-subscription. Sending
// marketing by electronic means is the one thing that genuinely does need consent
// (art. 6(1)(a) GDPR + art. 398 of the Polish Electronic Communications Law).
export const ACCOUNT_CONSENT_TYPES = ['marketing'] as const
export type AccountConsentType = (typeof ACCOUNT_CONSENT_TYPES)[number]

export function isAccountConsentType(value: string): value is AccountConsentType {
  return (ACCOUNT_CONSENT_TYPES as readonly string[]).includes(value)
}

// Decisions reuse the member-consent primitives rather than redefining them: the
// doctrine is identical (withdrawal keeps the row and its grantedAt, because that
// timestamp is the art. 7(1) evidence of the period during which processing was
// lawful), and two copies of it would eventually drift apart.
export { CONSENT_DECISIONS, type ConsentDecision } from './member-consent'

// Absence of a row means "never asked", which under GDPR means NO. Failing open
// here would mean emailing someone who never agreed to be emailed, so the default
// is always false.
export function hasAccountConsent(record: { status: string } | null | undefined): boolean {
  return record?.status === 'granted'
}

// What a user accepted, as stored. Both versions are required: a single "accepted
// the legal stuff" boolean could not answer "accepted WHICH wording?", which is
// the only question that matters when the wording changes.
export interface LegalAcceptance {
  termsVersion: string
  privacyVersion: string
  acceptedAt: Date
}

// True when either document has moved on since the user last accepted. Missing
// acceptance counts as needing it — an account created before this feature
// existed has no row, and must be asked rather than assumed to have agreed.
export function needsReacceptance(acceptance: LegalAcceptance | null | undefined): boolean {
  if (!acceptance) {
    return true
  }
  return (
    acceptance.termsVersion !== LEGAL_DOCUMENT_VERSIONS.terms
    || acceptance.privacyVersion !== LEGAL_DOCUMENT_VERSIONS.privacy
  )
}
