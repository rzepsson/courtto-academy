import {
  orgProfileSectionSchemas,
  type ProfileErrorCode,
  type ProfileField
} from '~~/shared/org-profile-schema'

export {
  SPORTS,
  PROFILE_LOCALES,
  REQUIRED_PROFILE_FIELDS,
  computeProfileCompletion
} from '~~/shared/org-profile'
export type { Sport, ProfileLocale, RequiredProfileField, ProfileCompletion } from '~~/shared/org-profile'

export {
  PROFILE_SECTIONS,
  PROFILE_SECTION_FIELDS,
  type ProfileSection
} from '~~/shared/org-profile-schema'

// The client-side shape of the editable profile: a flat form-binding record where
// nullable server values render as '' and `sports` is a string[]. Derived from the
// schema's fields, so adding a profile field flows here automatically.
export type ProfileFormState = {
  [K in ProfileField]: K extends 'sports' ? string[] : string
}

// Maps each stable schema error code to its localized message key (rule 5). The
// server emits the raw codes; only the form surfaces them, so the mapping lives
// on the client. Format-specific codes get a specific message; the rest — only
// reachable by a crafted request, since the form's inputs constrain them — fall
// back to a generic "invalid" string.
const PROFILE_ERROR_KEYS: Record<ProfileErrorCode, string> = {
  tooLong: 'school.settings.errors.tooLong',
  email: 'school.settings.errors.email',
  phone: 'school.settings.errors.phone',
  url: 'school.settings.errors.url',
  sport: 'school.settings.errors.invalid',
  country: 'school.settings.errors.invalid',
  currency: 'school.settings.errors.invalid',
  locale: 'school.settings.errors.invalid',
  timezone: 'school.settings.errors.invalid'
}

// Localized per-section validation schemas for the settings form. Each card binds
// its section's schema to `UForm :schema`, so validation reads from the same
// rules the server enforces. Rebuilt per locale (call inside a computed) so error
// messages follow the UI language.
export function profileSectionSchemas(t: (key: string) => string) {
  return orgProfileSectionSchemas(code => t(PROFILE_ERROR_KEYS[code]))
}
