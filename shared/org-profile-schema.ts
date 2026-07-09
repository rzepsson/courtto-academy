// The single, canonical definition of what a valid school profile is. One Zod
// schema drives BOTH ends: the client binds section slices to `UForm :schema`
// for live form validation, and the server parses the PATCH body against the
// same rules (see server/utils/services/orgProfile.ts). Because both derive from
// this file, the form and the API can never drift on allowed values, length caps
// or formats. Keep it free of Nuxt/Node imports — `shared/` loads in any context.

import { z } from 'zod'
import {
  PROFILE_LIMITS,
  PROFILE_LOCALES,
  isEmailLike,
  isHttpUrlLike,
  isPhoneLike,
  isSport,
  type Sport
} from './org-profile'
import { isValidTimezone } from './regional'

// Stable, machine error codes the schema raises. The wording is supplied by a
// resolver, not baked in: the client maps each code to a localized i18n string
// (rule 5), while the server maps it to itself — a server-side failure is
// defense-in-depth behind the form and its message is never shown to a user.
export const PROFILE_ERROR_CODES = [
  'tooLong', 'email', 'phone', 'url', 'sport', 'country', 'currency', 'locale', 'timezone'
] as const
export type ProfileErrorCode = (typeof PROFILE_ERROR_CODES)[number]

export type ProfileMessageResolver = (code: ProfileErrorCode) => string

// Every profile field is optional-by-emptiness — a school fills it in over time —
// so all of them accept '' and collapse whitespace-only input to null, clearing
// the stored value instead of persisting an empty string.

function text(max: number, msg: ProfileMessageResolver) {
  return z
    .string()
    .trim()
    .max(max, msg('tooLong'))
    .transform(value => (value === '' ? null : value))
}

// Free text that, when non-empty, must also pass a format check.
function formatted(
  max: number,
  isValid: (value: string) => boolean,
  code: ProfileErrorCode,
  msg: ProfileMessageResolver
) {
  return z
    .string()
    .trim()
    .max(max, msg('tooLong'))
    .refine(value => value === '' || isValid(value), msg(code))
    .transform(value => (value === '' ? null : value))
}

// A fixed-length uppercase code — country (ISO 3166-1 alpha-2), currency (ISO
// 4217). Normalized to upper case before matching so 'pl' and 'PL' both store PL.
function fixedCode(length: number, code: ProfileErrorCode, msg: ProfileMessageResolver) {
  const pattern = new RegExp(`^[A-Z]{${length}}$`)
  return z
    .string()
    .trim()
    .toUpperCase()
    .refine(value => value === '' || pattern.test(value), msg(code))
    .transform(value => (value === '' ? null : value))
}

// The complete field-by-field definition, parameterized by the message resolver.
export function orgProfileSchema(msg: ProfileMessageResolver) {
  return z.object({
    description: text(PROFILE_LIMITS.description, msg),
    // Buttons on the client only ever emit known sports; the refine is the
    // server-side guard against a crafted request. Deduped, never localized text.
    sports: z
      .array(z.string())
      .refine(values => values.every(isSport), msg('sport'))
      .transform(values => [...new Set(values)] as Sport[]),

    contactEmail: formatted(PROFILE_LIMITS.email, isEmailLike, 'email', msg),
    contactPhone: formatted(PROFILE_LIMITS.short, isPhoneLike, 'phone', msg),
    websiteUrl: formatted(PROFILE_LIMITS.url, isHttpUrlLike, 'url', msg),
    instagramUrl: formatted(PROFILE_LIMITS.url, isHttpUrlLike, 'url', msg),
    facebookUrl: formatted(PROFILE_LIMITS.url, isHttpUrlLike, 'url', msg),

    addressLine1: text(PROFILE_LIMITS.short, msg),
    addressLine2: text(PROFILE_LIMITS.short, msg),
    city: text(PROFILE_LIMITS.short, msg),
    postalCode: text(PROFILE_LIMITS.short, msg),
    country: fixedCode(2, 'country', msg),

    timezone: z
      .string()
      .trim()
      .max(64, msg('tooLong'))
      .refine(value => value === '' || isValidTimezone(value), msg('timezone'))
      .transform(value => (value === '' ? null : value)),
    locale: z
      .string()
      .trim()
      .refine(value => value === '' || (PROFILE_LOCALES as readonly string[]).includes(value), msg('locale'))
      .transform(value => (value === '' ? null : value)),
    currency: fixedCode(3, 'currency', msg),

    legalName: text(PROFILE_LIMITS.name, msg),
    taxId: text(PROFILE_LIMITS.taxId, msg)
  })
}

// The normalized, stored shape of an editable profile (all fields, post-transform).
export type OrgProfileValues = z.infer<ReturnType<typeof orgProfileSchema>>
export type ProfileField = keyof OrgProfileValues

// Which fields belong to which settings section. The single source of truth for
// section grouping — the settings page reads this for dirty-checks and PATCH
// bodies, and the section schemas below are picked from it, so a field is
// assigned to a section in exactly one place.
export const PROFILE_SECTIONS = ['public', 'contact', 'location', 'regional', 'business'] as const
export type ProfileSection = (typeof PROFILE_SECTIONS)[number]

export const PROFILE_SECTION_FIELDS = {
  public: ['description', 'sports'],
  contact: ['contactEmail', 'contactPhone', 'websiteUrl', 'instagramUrl', 'facebookUrl'],
  location: ['addressLine1', 'addressLine2', 'city', 'postalCode', 'country'],
  regional: ['timezone', 'locale', 'currency'],
  business: ['legalName', 'taxId']
} as const satisfies Record<ProfileSection, readonly ProfileField[]>

// A validation schema for one section only, so saving one card never surfaces (or
// is blocked by) another section's errors — Zod strips the keys it doesn't define.
// Partial so a form binding it validates the fields the user touched without
// requiring the whole section to be present.
export function orgProfileSectionSchema(section: ProfileSection, msg: ProfileMessageResolver) {
  const mask = Object.fromEntries(PROFILE_SECTION_FIELDS[section].map(field => [field, true]))
  return orgProfileSchema(msg).pick(mask as Record<ProfileField, true>).partial()
}

// Every section's schema, keyed — convenient for the settings page to build once
// (per locale) and bind each card to its slice.
export function orgProfileSectionSchemas(msg: ProfileMessageResolver) {
  return Object.fromEntries(
    PROFILE_SECTIONS.map(section => [section, orgProfileSectionSchema(section, msg)])
  ) as Record<ProfileSection, ReturnType<typeof orgProfileSectionSchema>>
}

// The PATCH schema: partial, so only the keys actually present in the body are
// validated and returned — each section saves independently without clobbering
// the others. Used server-side with the identity resolver (raw codes).
export function orgProfilePatchSchema(msg: ProfileMessageResolver) {
  return orgProfileSchema(msg).partial()
}
