// The single, canonical definition of what a valid court is. One Zod schema
// drives BOTH ends: the client binds it to `UForm :schema` for live validation,
// and the server parses the POST/PATCH body against the same rules (see
// server/utils/services/courts.ts). Because both derive from this file, the form
// and the API can never drift on formats, enums, colours or length caps. Mirrors
// shared/org-profile-schema.ts. Keep it free of Nuxt/Node imports.
//
// Two court rules are deliberately NOT here — they need runtime context this
// static schema doesn't have, so they stay in the service: (1) the discipline
// must be one the facility offers (orgProfile.sports), and (2) the surface must
// be valid for the *effective* sport (which, on a partial update, may be the
// stored one). The schema owns everything context-free.

import { z } from 'zod'
import {
  COURT_LIMITS,
  isCourtEnvironment,
  isCourtSport,
  isHexColor
} from './courts'

// Stable machine codes the schema raises; wording comes from a resolver, not
// baked in (client → localized i18n keys, server → identity/raw codes that are
// never user-facing — server validation is defense-in-depth behind the form).
export const COURT_ERROR_CODES = [
  'nameRequired', 'tooLong', 'color', 'surface', 'sport', 'environment'
] as const
export type CourtErrorCode = (typeof COURT_ERROR_CODES)[number]

export type CourtMessageResolver = (code: CourtErrorCode) => string

// Optional free text that collapses whitespace-only / empty input to null,
// clearing the stored value instead of persisting an empty string.
function optionalText(max: number, msg: CourtMessageResolver) {
  return z
    .string()
    .trim()
    .max(max, msg('tooLong'))
    .transform(value => (value === '' ? null : value))
    .nullable()
    .optional()
}

function color(msg: CourtMessageResolver) {
  return z.string().trim().refine(isHexColor, msg('color'))
}

// The complete field-by-field definition, parameterized by the message resolver.
// Only `name` + `sport` are required; everything else is optional. Operational
// defaults (environment/lineColor/surfaceColor) are applied by the service
// on create, NOT via Zod `.default()` — a default on an optional field would be
// re-injected by `.partial()` on the PATCH schema and silently reset an untouched
// field. So the schema validates presence/format only; the service owns defaults.
export function courtSchema(msg: CourtMessageResolver) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, msg('nameRequired'))
      .max(COURT_LIMITS.name, msg('tooLong')),
    // Buttons on the client only ever emit offered sports; the refine is the
    // server-side guard. The facility-offer check itself lives in the service.
    sport: z.string().refine(isCourtSport, msg('sport')),
    // Format only — surface-vs-sport validity is checked in the service, which
    // knows the effective sport on a partial update.
    surface: optionalText(40, msg),
    environment: z.string().refine(isCourtEnvironment, msg('environment')).optional(),
    surfaceColor: color(msg).optional(),
    lineColor: color(msg).optional(),
    zone: optionalText(COURT_LIMITS.zone, msg),
    notes: optionalText(COURT_LIMITS.notes, msg)
  })
}

// The normalized shape of a court's writable values (post-transform).
export type CourtValues = z.infer<ReturnType<typeof courtSchema>>

// Create: name + discipline required; the service fills operational defaults.
export function courtCreateSchema(msg: CourtMessageResolver) {
  return courtSchema(msg)
}

// Update: partial, so only the keys present in the PATCH body are validated and
// applied — each field updates independently without clobbering the rest. Since
// no field carries a Zod default, an absent key stays absent (never reset).
export function courtPatchSchema(msg: CourtMessageResolver) {
  return courtSchema(msg).partial()
}
