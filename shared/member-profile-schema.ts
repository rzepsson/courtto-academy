// The single, canonical definition of what a valid member-profile patch is. One
// Zod schema drives BOTH ends (like org-profile-schema.ts / courts-schema.ts):
// the staff form binds a slice to `UForm :schema`, and the server parses the
// PATCH body against the same rules (server/utils/services/memberProfile.ts), so
// form and API can never drift. Keep it free of Nuxt/Node imports — shared/ loads
// in any context.

import { z } from 'zod'
import { MEMBER_PROFILE_LIMITS, isMemberStatus, normalizeTags } from './member-profile'
import { calculateAge } from './member-guardian'

// Stable, machine error codes the schema raises. Wording is supplied by a
// resolver, not baked in: the client maps each code to a localized i18n string
// (rule 5); the server maps it to itself (a server-side failure is defense in
// depth behind the form — its message is never shown to a user).
export const MEMBER_PROFILE_ERROR_CODES = ['status', 'tooLong', 'tags', 'date'] as const
export type MemberProfileErrorCode = (typeof MEMBER_PROFILE_ERROR_CODES)[number]

export type MemberProfileMessageResolver = (code: MemberProfileErrorCode) => string

// The complete field-by-field definition, parameterized by the message resolver.
export function memberProfileSchema(msg: MemberProfileMessageResolver) {
  return z.object({
    status: z.string().refine(isMemberStatus, msg('status')),
    canCoach: z.boolean(),
    // A plain 'YYYY-MM-DD' calendar date. One check covers every way this goes
    // wrong: calculateAge returns null for a malformed date, an impossible one
    // (2026-02-31), a future birth date (negative age) and an absurd one (age
    // > 120) — so a typo'd year can't quietly make someone a minor.
    dateOfBirth: z
      .string()
      .trim()
      .refine(value => value === '' || calculateAge(value) !== null, msg('date'))
      .transform(value => (value === '' ? null : value)),
    // Staff-only note — collapses whitespace-only input to null (clears it).
    notes: z
      .string()
      .trim()
      .max(MEMBER_PROFILE_LIMITS.notes, msg('tooLong'))
      .transform(value => (value === '' ? null : value)),
    // Labels are normalized + deduped before the length cap is checked, so the
    // limit counts the values we would actually store, not raw duplicates.
    tags: z
      .array(z.string())
      .transform(normalizeTags)
      .refine(values => values.length <= MEMBER_PROFILE_LIMITS.tags, msg('tags'))
  })
}

// The normalized, stored shape of a member profile (all fields, post-transform).
export type MemberProfileValues = z.infer<ReturnType<typeof memberProfileSchema>>

// The PATCH schema: partial, so only the keys actually present in the body are
// validated and returned — each control saves independently without clobbering
// the others. Used server-side with the identity resolver (raw codes).
export function memberProfilePatchSchema(msg: MemberProfileMessageResolver) {
  return memberProfileSchema(msg).partial()
}
