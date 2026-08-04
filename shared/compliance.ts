// Roster-level compliance gaps (RODO/GDPR) — PURE, no Nuxt/Node imports (the
// shared/ rule). CORE, like the guardian + consent models it composes: it asks
// "which people on the roster are we still responsible to for a compliance
// artifact?", never anything about lessons.
//
// The two gaps are deliberately the SAME shape — one classifier, one report:
//   • missingGuardian     — a minor with nobody to call (needsGuardian).
//   • missingImageConsent — image consent NEVER ASKED (state 'unknown').
//
// Why 'unknown' and NOT "anything but granted": a WITHDRAWN consent is a decision
// to respect, not a gap to chase. Surfacing it as a gap would nudge staff to
// re-ask, which the consent doctrine forbids (see shared/member-consent.ts —
// withdrawal must never be re-asked casually). So only the actionable, chase-able
// state counts here; a withdrawal is a known "no", not missing paperwork. This is
// exactly the distinction CONSENT_STATES exists to preserve.

import { needsGuardian } from './member-guardian'
import { consentState } from './member-consent'

export interface ComplianceInput {
  // The member's calendar date of birth ('YYYY-MM-DD') or null when unknown — a
  // null DOB can't establish minority, so it never raises the guardian gap (a
  // false "needs guardian" on every DOB-less adult would be noise).
  dateOfBirth: string | null
  guardianCount: number
  // The member's stored image-consent decision ('granted' | 'withdrawn') or null
  // when there's no row at all ("never asked").
  imageConsentStatus: string | null
}

export interface ComplianceGaps {
  missingGuardian: boolean
  missingImageConsent: boolean
}

export function evaluateCompliance(input: ComplianceInput, asOf: Date = new Date()): ComplianceGaps {
  return {
    missingGuardian: needsGuardian(input.dateOfBirth, input.guardianCount, asOf),
    missingImageConsent: consentState(
      input.imageConsentStatus ? { status: input.imageConsentStatus } : null
    ) === 'unknown'
  }
}

export function hasComplianceGap(gaps: ComplianceGaps): boolean {
  return gaps.missingGuardian || gaps.missingImageConsent
}
