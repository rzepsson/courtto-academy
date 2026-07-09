import type { Sport } from '~~/shared/org-profile'
import type { CourtDto } from '~~/server/database/types'
import { COURT_ENVIRONMENTS, COURT_STATUSES, SURFACES_BY_SPORT } from '~~/shared/courts'
import { courtSchema, type CourtErrorCode } from '~~/shared/courts-schema'

// Client-facing re-exports of the shared court domain, plus form-only helpers.
// app/utils/* is auto-imported, so pages/components get these without importing
// from ~~/shared directly (mirrors app/utils/orgProfile.ts).
export {
  COURT_SPECS,
  COURT_ENVIRONMENTS,
  COURT_STATUSES,
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
export type { CourtUnit, CourtEnvironment, CourtStatus, CourtSpec } from '~~/shared/courts'

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
  status: string
  surfaceColor: string
  lineColor: string
  zone: string
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
  environment: 'courts.form.errors.invalid',
  status: 'courts.form.errors.invalid'
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

export function courtStatusOptions(t: (key: string) => string): { value: string, label: string }[] {
  return COURT_STATUSES.map(value => ({ value, label: t(`courts.status.${value}`) }))
}
