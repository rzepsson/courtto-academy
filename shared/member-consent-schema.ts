// The canonical definition of a valid consent decision. One Zod schema drives both
// the staff form and the server, so they can't drift. Free of Nuxt/Node imports.

import { z } from 'zod'
import { CONSENT_LIMITS, isConsentDecision } from './member-consent'

export const CONSENT_ERROR_CODES = ['decision', 'tooLong'] as const
export type ConsentErrorCode = (typeof CONSENT_ERROR_CODES)[number]

export type ConsentMessageResolver = (code: ConsentErrorCode) => string

// Recording a decision. `guardianId` is intentionally NOT validated for presence
// here: whether a guardian is *required* depends on the member's age, which this
// schema can't see — the service resolves it against the stored date of birth
// (the same context-rule split the courts service uses for "effective sport").
export function consentDecisionSchema(msg: ConsentMessageResolver) {
  return z.object({
    status: z.string().refine(isConsentDecision, msg('decision')),
    guardianId: z
      .string()
      .trim()
      .transform(value => (value === '' ? null : value))
      .nullable()
      .optional(),
    documentVersion: z
      .string()
      .trim()
      .max(CONSENT_LIMITS.documentVersion, msg('tooLong'))
      .transform(value => (value === '' ? null : value)),
    notes: z
      .string()
      .trim()
      .max(CONSENT_LIMITS.notes, msg('tooLong'))
      .transform(value => (value === '' ? null : value))
  })
}

export type ConsentDecisionValues = z.infer<ReturnType<typeof consentDecisionSchema>>
