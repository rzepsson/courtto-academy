// The canonical definition of a valid pricing plan. One Zod schema drives BOTH
// ends (like courts-schema.ts / member-guardian-schema.ts): the staff form binds
// it to `UForm :schema`, and the server parses the request body against the same
// rules, so form and API can never drift. Free of Nuxt/Node imports.
//
// A plan's CURRENCY and billing INTERVAL are NOT in this schema: the currency is
// snapshotted from the school's profile at creation (a school bills in one
// currency), and the interval is monthly by definition (the locked V1 model). Both
// are set by the service, not the client.

import { z } from 'zod'

export const PRICING_PLAN_LIMITS = {
  name: 100,
  description: 500,
  // A sane ceiling in minor units (grosze) so a typo can't create a 9,999,999 zł
  // plan; Stripe still enforces its own per-currency minimum at charge time.
  maxAmountMinor: 1_000_000_00
} as const

// Stable machine codes; wording comes from a resolver (client → localized i18n,
// server → the raw code, which is never user-facing behind the form).
export const PRICING_PLAN_ERROR_CODES = ['required', 'tooLong', 'amount'] as const
export type PricingPlanErrorCode = (typeof PRICING_PLAN_ERROR_CODES)[number]
export type PricingPlanMessageResolver = (code: PricingPlanErrorCode) => string

function base(msg: PricingPlanMessageResolver) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, msg('required'))
      .max(PRICING_PLAN_LIMITS.name, msg('tooLong')),
    description: z
      .string()
      .trim()
      .max(PRICING_PLAN_LIMITS.description, msg('tooLong'))
      .transform(value => (value === '' ? null : value)),
    // Money is INTEGER minor units (grosze), never a float — the single rule that
    // keeps every downstream calculation exact.
    amountMinor: z
      .number()
      .int(msg('amount'))
      .positive(msg('amount'))
      .max(PRICING_PLAN_LIMITS.maxAmountMinor, msg('amount'))
  })
}

export function pricingPlanCreateSchema(msg: PricingPlanMessageResolver) {
  return base(msg)
}

// Patch: same field rules, all optional (a section may update just the name or
// just the price).
export function pricingPlanPatchSchema(msg: PricingPlanMessageResolver) {
  return base(msg).partial()
}

export type PricingPlanValues = z.infer<ReturnType<typeof base>>
