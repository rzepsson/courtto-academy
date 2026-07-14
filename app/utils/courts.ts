import type { Sport } from '~~/shared/org-profile'
import type { CourtDto, CourtZoneDto } from '~~/server/database/types'
import { COURT_ENVIRONMENTS, SURFACES_BY_SPORT, courtUnit, isCourtSport } from '~~/shared/courts'
import { courtSchema, type CourtErrorCode } from '~~/shared/courts-schema'
import { courtZoneSchema, type CourtZoneErrorCode } from '~~/shared/court-zone-schema'

// Client-facing re-exports of the shared court domain, plus form-only helpers.
// app/utils/* is auto-imported, so pages/components get these without importing
// from ~~/shared directly (mirrors app/utils/orgProfile.ts).
export {
  COURT_SPECS,
  COURT_ENVIRONMENTS,
  COURT_COLOR_PRESETS,
  DEFAULT_SURFACE_COLOR,
  DEFAULT_LINE_COLOR,
  SURFACES_BY_SPORT,
  COURT_LIMITS,
  courtSpec,
  courtUnit,
  isCourtSport,
  isValidSurfaceFor,
  isHexColor
} from '~~/shared/courts'
export type { CourtUnit, CourtEnvironment, CourtSpec } from '~~/shared/courts'

// The client-side court shape: over HTTP the Date columns arrive JSON-serialized
// as ISO strings, so the roster/card/builder bind against this (not the server
// CourtDto, whose date fields are Date).
export type CourtView = Omit<CourtDto, 'archivedAt' | 'createdAt'> & {
  archivedAt: string | null
  createdAt: string
}

// The flat form-binding shape for the builder. Nullable server fields render as
// '' here; the shared schema transforms empties back to null on validate.
export interface CourtFormState {
  name: string
  sport: string
  surface: string
  environment: string
  surfaceColor: string
  lineColor: string
  zoneId: string
  notes: string
}

// Maps each stable schema error code to its localized message key (rule 5). The
// server emits raw codes; only the form surfaces them. Format-specific codes get
// a specific message; the rest — only reachable by a crafted request, since the
// form's controls constrain them — fall back to a generic "invalid" string.
const COURT_ERROR_KEYS: Record<CourtErrorCode, string> = {
  nameRequired: 'courts.form.errors.nameRequired',
  tooLong: 'courts.form.errors.tooLong',
  color: 'courts.form.errors.color',
  surface: 'courts.form.errors.invalid',
  sport: 'courts.form.errors.invalid',
  environment: 'courts.form.errors.invalid'
}

// The builder binds this to `UForm :schema` — the same shared schema the server
// validates against, so form and API can never drift. Rebuilt per-locale (call
// inside a computed) so messages follow the UI language.
export function courtFormSchema(t: (key: string) => string) {
  return courtSchema(code => t(COURT_ERROR_KEYS[code]))
}

// Localized select options, rebuilt per-locale (call inside a computed).
export function courtSurfaceOptions(sport: string, t: (key: string) => string): { value: string, label: string }[] {
  const surfaces = SURFACES_BY_SPORT[sport as Sport] ?? []
  return surfaces.map(surface => ({ value: surface, label: t(`courts.surfaces.${surface}`) }))
}

export function courtEnvironmentOptions(t: (key: string) => string): { value: string, label: string }[] {
  return COURT_ENVIRONMENTS.map(value => ({ value, label: t(`courts.environments.${value}`) }))
}

// The localized unit noun for a sport — "Court" (tennis, padel, squash, …) or
// "Table" (table tennis). Sport-specific UI (a lesson slot's court field, a
// session's court row, the court builder) shows this instead of a hardcoded
// "court", so picking table tennis reads "Table"/"Stół". Falls back to the court
// unit for unrecognized input. Rebuilt per-locale (call inside a computed).
export function courtUnitLabel(sport: string, t: (key: string) => string): string {
  return t(`courts.unit.${isCourtSport(sport) ? courtUnit(sport) : 'court'}`)
}

// The concise "sport · surface · environment" descriptor (only the parts
// present), shared by the roster tile and the detail page so they never drift.
// The zone is deliberately NOT here — it's a first-class grouping (roster
// sections / a distinct field), not an inline metadata string.
export function courtMetaParts(
  court: Pick<CourtView, 'sport' | 'surface' | 'environment'>,
  t: (key: string) => string
): string[] {
  const parts = [t(`school.settings.sports.${court.sport}`)]
  if (court.surface) parts.push(t(`courts.surfaces.${court.surface}`))
  parts.push(t(`courts.environments.${court.environment}`))
  return parts
}

// A facility zone, client-side. CourtZoneDto carries no Date fields, so the view
// shape is identical — aliased for symmetry with CourtView.
export type CourtZoneView = CourtZoneDto

// Sentinel for the "no zone" select option. USelectMenu (Reka) reserves the
// empty-string value for clearing the selection and throws on an item that uses
// '', so the picker uses this token and the form maps it back to null on submit
// (mirrors NO_COACH_VALUE).
export const NO_ZONE_VALUE = '__none__'

const COURT_ZONE_ERROR_KEYS: Record<CourtZoneErrorCode, string> = {
  nameRequired: 'courts.zones.form.errors.nameRequired',
  tooLong: 'courts.zones.form.errors.tooLong'
}

// The manage-zones editor binds this to `UForm :schema` — the same shared schema
// the server validates against. Rebuilt per-locale (call inside a computed).
export function courtZoneFormSchema(t: (key: string) => string) {
  return courtZoneSchema(code => t(COURT_ZONE_ERROR_KEYS[code]))
}
