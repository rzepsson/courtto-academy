// Guardian / minor domain — pure, no Nuxt/Node imports (the shared/ rule).
//
// CORE, not Academy: this is about a *person*, not about lessons. A racket school
// teaches mostly children, but a future Courtto facility with junior members needs
// exactly the same model — so it lives beside member-profile.ts and moves with the
// core, not with the Academy layer.

import { isEmailLike, isPhoneLike } from './org-profile'

// Legal adulthood. A named constant because it's a policy, not a magic number: 18
// in Poland and most of the EU. A per-country override is the documented seam —
// nothing here hard-codes the jurisdiction beyond this line.
export const MINOR_AGE_YEARS = 18

// How the guardian relates to the member. `other` keeps the list honest rather
// than forcing a family shape onto every household (grandparent, sibling, carer).
export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'guardian', 'other'] as const
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number]

export function isGuardianRelationship(value: string): value is GuardianRelationship {
  return (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(value)
}

export const GUARDIAN_LIMITS = {
  name: 120,
  phone: 32,
  email: 160,
  notes: 500,
  // A sane ceiling per member (both parents + a grandparent + a carer covers
  // reality); it exists to stop abuse, not to model families.
  perMember: 6
} as const

// The oldest plausible living person, as a guard against typos like year 1090.
const MAX_AGE_YEARS = 120

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// A birth date is a CALENDAR date ('YYYY-MM-DD'), never an instant: pinning it to
// a timezone would shift someone's birthday across the date line. So the whole
// model here is calendar arithmetic.
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) {
    return false
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  // Round-trip through UTC to reject impossible dates (2026-02-31, month 13).
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// Whole years elapsed, calendar-correct: a birthday that hasn't come round yet
// this year does NOT count. A naive `thisYear - birthYear` is wrong for roughly
// half the population on any given day — this is the bug that silently turns
// 17-year-olds into adults.
//
// `asOf` is read in UTC. A birthday can therefore flip up to a day early/late in a
// distant zone; that's immaterial here because nothing is *gated* on the result —
// it drives a badge and a "who do we call?" prompt, not access or legal capacity.
export function calculateAge(dateOfBirth: string, asOf: Date = new Date()): number | null {
  if (!isCalendarDate(dateOfBirth)) {
    return null
  }
  const match = DATE_PATTERN.exec(dateOfBirth)!
  const birthYear = Number(match[1])
  const birthMonth = Number(match[2])
  const birthDay = Number(match[3])

  const year = asOf.getUTCFullYear()
  const month = asOf.getUTCMonth() + 1
  const day = asOf.getUTCDate()

  let age = year - birthYear
  if (month < birthMonth || (month === birthMonth && day < birthDay)) {
    age -= 1
  }

  return age < 0 || age > MAX_AGE_YEARS ? null : age
}

export function isMinor(dateOfBirth: string | null | undefined, asOf: Date = new Date()): boolean {
  if (!dateOfBirth) {
    return false
  }
  const age = calculateAge(dateOfBirth, asOf)
  return age !== null && age < MINOR_AGE_YEARS
}

// The gap a school actually has to close: a child on the roster with nobody to
// call. Deliberately DERIVED (never a stored flag, which would drift as birthdays
// pass) and surfaced as a warning — never enforced as a block. A student is
// routinely added before their paperwork arrives; refusing that would push the
// school straight back to the spreadsheet this product is replacing.
export function needsGuardian(
  dateOfBirth: string | null | undefined,
  guardianCount: number,
  asOf: Date = new Date()
): boolean {
  return isMinor(dateOfBirth, asOf) && guardianCount === 0
}

// A guardian is only reachable if at least one channel is filled in — a contact
// record with a name and nothing else is exactly the failure this model exists to
// prevent. Both formats reuse the org-profile checks, so "what a valid phone/email
// looks like" is defined once in the codebase.
export function hasReachableChannel(guardian: { phone?: string | null, email?: string | null }): boolean {
  return Boolean(
    (guardian.phone && isPhoneLike(guardian.phone))
    || (guardian.email && isEmailLike(guardian.email))
  )
}
