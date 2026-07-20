// The canonical definition of a valid guardian record. One Zod schema drives BOTH
// ends (like org-profile-schema.ts / courts-schema.ts): the staff form binds it to
// `UForm :schema`, and the server parses the request body against the same rules,
// so form and API can never drift. Keep it free of Nuxt/Node imports.

import { z } from 'zod'
import { GUARDIAN_LIMITS, hasReachableChannel, isGuardianRelationship } from './member-guardian'
import { isEmailLike, isPhoneLike } from './org-profile'

// Stable machine codes; wording comes from a resolver (client → localized i18n,
// server → the raw code, which is never user-facing).
export const GUARDIAN_ERROR_CODES = [
  'required', 'tooLong', 'relationship', 'phone', 'email', 'unreachable'
] as const
export type GuardianErrorCode = (typeof GUARDIAN_ERROR_CODES)[number]

export type GuardianMessageResolver = (code: GuardianErrorCode) => string

// The field-by-field shape, without the cross-field rule. Kept separate because
// `.refine()` on an object yields a ZodEffects, which has no `.partial()` — the
// PATCH schema needs the plain object.
function guardianBase(msg: GuardianMessageResolver) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, msg('required'))
      .max(GUARDIAN_LIMITS.name, msg('tooLong')),
    relationship: z.string().refine(isGuardianRelationship, msg('relationship')),
    phone: z
      .string()
      .trim()
      .max(GUARDIAN_LIMITS.phone, msg('tooLong'))
      .refine(value => value === '' || isPhoneLike(value), msg('phone'))
      .transform(value => (value === '' ? null : value)),
    email: z
      .string()
      .trim()
      .max(GUARDIAN_LIMITS.email, msg('tooLong'))
      .refine(value => value === '' || isEmailLike(value), msg('email'))
      .transform(value => (value === '' ? null : value)),
    isPrimary: z.boolean(),
    notes: z
      .string()
      .trim()
      .max(GUARDIAN_LIMITS.notes, msg('tooLong'))
      .transform(value => (value === '' ? null : value))
  })
}

// Create: the cross-field rule applies in full — a guardian with a name and no way
// to reach them is a record that looks complete and fails at the only moment it
// matters. Reported on `phone`, the channel a school reaches for first.
export function guardianCreateSchema(msg: GuardianMessageResolver) {
  return guardianBase(msg).refine(hasReachableChannel, {
    message: msg('unreachable'),
    path: ['phone']
  })
}

// Patch: field rules only. Reachability is CONTEXT-dependent on a partial update
// (clearing `phone` is fine if `email` is already stored), so it's re-checked in
// the service against the merged record — the same split the courts service uses
// for "surface valid for the *effective* sport".
export function guardianPatchSchema(msg: GuardianMessageResolver) {
  return guardianBase(msg).partial()
}

export type GuardianValues = z.infer<ReturnType<typeof guardianBase>>
