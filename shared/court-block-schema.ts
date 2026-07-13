// The single, canonical definition of a valid court-block input. One Zod schema
// drives BOTH ends: the slideover binds it to `UForm :schema` for live
// validation, and the server parses the POST body against the same rules (see
// server/utils/services/courtBlocks.ts). Mirrors schedule-schema.ts /
// courts-schema.ts. Keep free of Nuxt/Node imports.
//
// Context-dependent rules stay in the service, not this static schema: the court
// id must resolve to a real, active court of this org, and the wall-clock range
// (once resolved to instants in the org's timezone) must be free of existing
// reservations. This schema owns everything context-free: shape, kind, ordering
// and the maximum span.

import { z } from 'zod'
import { COURT_BLOCK_MAX_DAYS, isCourtBlockKind } from './reservation'
import { SCHEDULE_LIMITS, isValidLocalDateTime } from './schedule'

// Stable machine codes the schema raises; wording comes from a resolver (client
// → localized i18n keys, server → identity/raw codes that are never user-facing).
export const COURT_BLOCK_ERROR_CODES = ['required', 'tooLong', 'kind', 'datetime', 'range', 'maxSpan'] as const
export type CourtBlockErrorCode = (typeof COURT_BLOCK_ERROR_CODES)[number]

export type CourtBlockMessageResolver = (code: CourtBlockErrorCode) => string

// Create a block: a wall-clock local [start, end) range (resolved to UTC in the
// org timezone by the service), a kind, and an optional short label. `startLocal`/
// `endLocal` are 'YYYY-MM-DDTHH:mm' — the same shape as the schedule's dtStart.
// The all-day/multi-day convenience is purely client-side (it just computes the
// two stamps); the wire contract stays a plain range.
export function courtBlockCreateSchema(msg: CourtBlockMessageResolver) {
  return z
    .object({
      kind: z.string().refine(isCourtBlockKind, msg('kind')).optional(),
      startLocal: z.string().trim().refine(isValidLocalDateTime, msg('datetime')),
      endLocal: z.string().trim().refine(isValidLocalDateTime, msg('datetime')),
      title: z
        .string()
        .trim()
        .max(SCHEDULE_LIMITS.title, msg('tooLong'))
        .transform(value => (value === '' ? null : value))
        .nullable()
        .optional()
    })
    // Ordering + span are checked on the wall-clock strings: they compare
    // lexicographically for same-zone stamps, and the day-count bound needs no
    // zone (it's a coarse guard, exact instants are re-checked in the service).
    .refine(value => value.endLocal > value.startLocal, { path: ['endLocal'], message: msg('range') })
    .refine(value => spanDays(value.startLocal, value.endLocal) <= COURT_BLOCK_MAX_DAYS, {
      path: ['endLocal'],
      message: msg('maxSpan')
    })
}

export type CourtBlockValues = z.infer<ReturnType<typeof courtBlockCreateSchema>>

// Coarse day span between two 'YYYY-MM-DDTHH:mm' stamps (UTC-parsed — the offset
// cancels since both share it), for the max-span guard only.
function spanDays(startLocal: string, endLocal: string): number {
  const start = Date.parse(`${startLocal}:00Z`)
  const end = Date.parse(`${endLocal}:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return (end - start) / 86_400_000
}
