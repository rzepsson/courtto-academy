// Shared org-profile constants and pure format helpers. Imported by both the
// server (PATCH normalization) and the client (form validation), so the two can
// never disagree on allowed sports, locales or length caps. Keep this free of
// Nuxt/Node imports — it must load in any context.

export const SPORTS = ['tennis', 'padel', 'squash', 'badminton', 'pickleball', 'tableTennis', 'beachTennis', 'racquetball'] as const
export type Sport = (typeof SPORTS)[number]

export function isSport(value: string): value is Sport {
  return (SPORTS as readonly string[]).includes(value)
}

// Default notification / UI language for the school.
export const PROFILE_LOCALES = ['pl', 'en'] as const
export type ProfileLocale = (typeof PROFILE_LOCALES)[number]

// Max stored length per field kind — enforced on both sides so the DB never
// receives oversized input and the form can surface a friendly error first.
export const PROFILE_LIMITS = {
  description: 600,
  name: 160, // legal name
  short: 120, // city, postal code, address lines, phone
  url: 300,
  email: 160,
  taxId: 40
} as const

// Deliberately permissive checks — we localize the error and never trust the
// client, but we also don't want to reject unusual-but-valid real-world input
// (international phone formats, long TLDs, subaddressed emails).
export function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function isHttpUrlLike(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isPhoneLike(value: string): boolean {
  // Digits, spaces and the usual separators; 6–20 digits.
  const digits = value.replace(/[^\d]/g, '')
  return /^[+()\d\s-]+$/.test(value) && digits.length >= 6 && digits.length <= 20
}

// The essential fields a school must fill in before it's considered ready to
// operate. Operational fields (timezone/locale/currency) are excluded on
// purpose — they carry safe defaults and never block. These four have no usable
// default: a contact identity for outbound notifications, at least one declared
// sport (drives terminology), and a basic location.
export const REQUIRED_PROFILE_FIELDS = ['contactEmail', 'sports', 'city', 'country'] as const
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number]

export interface ProfileCompletion {
  complete: boolean
  missing: RequiredProfileField[]
}

// Single source of truth for "is this school ready to operate?" — derived from
// the actual profile data rather than a stored flag, so it can never drift out
// of sync. Drives both the setup-notification lifecycle (created on org
// creation, resolved the moment this returns complete) and the settings
// checklist. `profile` is the defaulted shape from getOrgProfile, so absent
// values arrive as null / empty array.
export function computeProfileCompletion(profile: {
  contactEmail?: string | null
  sports?: readonly string[] | null
  city?: string | null
  country?: string | null
}): ProfileCompletion {
  const filled = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0

  const missing = REQUIRED_PROFILE_FIELDS.filter((field) => {
    if (field === 'sports') {
      return !profile.sports || profile.sports.length === 0
    }
    return !filled(profile[field])
  })

  return { complete: missing.length === 0, missing }
}
