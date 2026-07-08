import { eq } from 'drizzle-orm'
import { db } from '../db'
import { orgProfile } from '../../database/app-schema'
import type { OrgProfileInput } from '../../database/types'
import {
  PROFILE_LIMITS,
  PROFILE_LOCALES,
  isEmailLike,
  isHttpUrlLike,
  isPhoneLike,
  isSport
} from '../../../shared/org-profile'

// Sensible defaults for the regional fields so a school that never opened
// settings still behaves correctly (notification timing, billing currency).
// Poland-first, since that's the initial market. Text/contact fields default to
// null (empty in the UI); only these operational fields get a real default.
const PROFILE_DEFAULTS = {
  timezone: 'Europe/Warsaw',
  locale: 'pl',
  currency: 'PLN',
  country: 'PL'
} as const

// Returns the profile as a fully-shaped, defaulted object even when no row
// exists yet — the settings form always binds against a complete state.
export async function getOrgProfile(organizationId: string): Promise<OrgProfileInput> {
  const [row] = await db
    .select()
    .from(orgProfile)
    .where(eq(orgProfile.organizationId, organizationId))
    .limit(1)

  return {
    description: row?.description ?? null,
    sports: row?.sports ?? [],
    contactEmail: row?.contactEmail ?? null,
    contactPhone: row?.contactPhone ?? null,
    websiteUrl: row?.websiteUrl ?? null,
    instagramUrl: row?.instagramUrl ?? null,
    facebookUrl: row?.facebookUrl ?? null,
    addressLine1: row?.addressLine1 ?? null,
    addressLine2: row?.addressLine2 ?? null,
    city: row?.city ?? null,
    postalCode: row?.postalCode ?? null,
    country: row?.country ?? PROFILE_DEFAULTS.country,
    timezone: row?.timezone ?? PROFILE_DEFAULTS.timezone,
    locale: row?.locale ?? PROFILE_DEFAULTS.locale,
    currency: row?.currency ?? PROFILE_DEFAULTS.currency,
    legalName: row?.legalName ?? null,
    taxId: row?.taxId ?? null
  }
}

// Trim, collapse empties to null, and cap length. Returns undefined when the
// key wasn't in the request so we never overwrite a stored value with null on a
// partial section save.
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Expected a string' })
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.length > max) {
    throw createError({ statusCode: 400, statusMessage: 'Value too long' })
  }
  return trimmed
}

function bad(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

// Validate + normalize an untrusted PATCH body into a partial profile patch.
// Only keys actually present in the body are returned, so each settings section
// updates independently without clobbering the others. Throws 400 on bad input.
export function normalizeOrgProfilePatch(body: Record<string, unknown>): Partial<OrgProfileInput> {
  const patch: Partial<OrgProfileInput> = {}
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)

  if (has('description')) patch.description = cleanText(body.description, PROFILE_LIMITS.description)
  if (has('contactPhone')) {
    patch.contactPhone = cleanText(body.contactPhone, PROFILE_LIMITS.short)
    if (patch.contactPhone && !isPhoneLike(patch.contactPhone)) bad('Invalid phone')
  }
  if (has('addressLine1')) patch.addressLine1 = cleanText(body.addressLine1, PROFILE_LIMITS.short)
  if (has('addressLine2')) patch.addressLine2 = cleanText(body.addressLine2, PROFILE_LIMITS.short)
  if (has('city')) patch.city = cleanText(body.city, PROFILE_LIMITS.short)
  if (has('postalCode')) patch.postalCode = cleanText(body.postalCode, PROFILE_LIMITS.short)
  if (has('legalName')) patch.legalName = cleanText(body.legalName, PROFILE_LIMITS.name)
  if (has('taxId')) patch.taxId = cleanText(body.taxId, PROFILE_LIMITS.taxId)

  if (has('contactEmail')) {
    patch.contactEmail = cleanText(body.contactEmail, PROFILE_LIMITS.email)
    if (patch.contactEmail && !isEmailLike(patch.contactEmail)) bad('Invalid email')
  }

  for (const key of ['websiteUrl', 'instagramUrl', 'facebookUrl'] as const) {
    if (has(key)) {
      const value = cleanText(body[key], PROFILE_LIMITS.url)
      if (value && !isHttpUrlLike(value)) bad(`Invalid URL: ${key}`)
      patch[key] = value
    }
  }

  if (has('country')) {
    const value = cleanText(body.country, 2)
    if (value && !/^[A-Za-z]{2}$/.test(value)) bad('Invalid country')
    patch.country = value ? value.toUpperCase() : null
  }

  if (has('timezone')) {
    const value = cleanText(body.timezone, 64)
    if (value && !isValidTimezone(value)) bad('Invalid timezone')
    patch.timezone = value
  }

  if (has('currency')) {
    const value = cleanText(body.currency, 3)
    if (value && !/^[A-Za-z]{3}$/.test(value)) bad('Invalid currency')
    patch.currency = value ? value.toUpperCase() : null
  }

  if (has('locale')) {
    const value = cleanText(body.locale, 5)
    if (value && !(PROFILE_LOCALES as readonly string[]).includes(value)) bad('Invalid locale')
    patch.locale = value
  }

  if (has('sports')) {
    if (!Array.isArray(body.sports)) bad('sports must be an array')
    const sports = [...new Set(body.sports.map(String))]
    if (!sports.every(isSport)) bad('Invalid sport')
    patch.sports = sports
  }

  return patch
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// Insert-or-update the profile for an org. Accepts a partial patch (settings
// saves one section at a time), so only the provided keys are written.
export async function upsertOrgProfile(
  organizationId: string,
  patch: Partial<OrgProfileInput>
): Promise<OrgProfileInput> {
  await db
    .insert(orgProfile)
    .values({ organizationId, ...PROFILE_DEFAULTS, ...patch })
    .onConflictDoUpdate({ target: orgProfile.organizationId, set: patch })

  return getOrgProfile(organizationId)
}
