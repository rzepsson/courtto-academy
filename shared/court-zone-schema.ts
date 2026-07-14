// The single, canonical definition of a valid court zone (area/hall) input. One
// Zod schema drives BOTH ends: the manage-zones UI binds it for live validation,
// and the server parses the POST/PATCH body against the same rules (see
// server/utils/services/courtZones.ts). Mirrors courts-schema.ts. Keep free of
// Nuxt/Node imports.
//
// The one context-dependent rule stays in the service: a zone name is
// case-insensitively unique per facility (enforced by a partial unique index +
// a friendly 409). This schema owns everything context-free: presence + length.

import { z } from 'zod'
import { COURT_LIMITS } from './courts'

export const COURT_ZONE_ERROR_CODES = ['nameRequired', 'tooLong'] as const
export type CourtZoneErrorCode = (typeof COURT_ZONE_ERROR_CODES)[number]
export type CourtZoneMessageResolver = (code: CourtZoneErrorCode) => string

// Create and rename share the same shape — a zone is just a named, orderable
// grouping (its sortOrder is managed by the service, never sent by the client).
export function courtZoneSchema(msg: CourtZoneMessageResolver) {
  return z.object({
    name: z.string().trim().min(1, msg('nameRequired')).max(COURT_LIMITS.zoneName, msg('tooLong'))
  })
}

export type CourtZoneValues = z.infer<ReturnType<typeof courtZoneSchema>>
