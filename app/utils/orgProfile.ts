import type { FormError } from '@nuxt/ui'
import { isEmailLike, isHttpUrlLike, isPhoneLike } from '~~/shared/org-profile'

export { SPORTS, PROFILE_LOCALES } from '~~/shared/org-profile'
export type { Sport, ProfileLocale } from '~~/shared/org-profile'

// The client-side shape of the editable profile — a flat record of strings
// (nullable server values render as ''); `sports` is a string[].
export interface ProfileFormState {
  description: string
  sports: string[]
  contactEmail: string
  contactPhone: string
  websiteUrl: string
  instagramUrl: string
  facebookUrl: string
  addressLine1: string
  addressLine2: string
  city: string
  postalCode: string
  country: string
  timezone: string
  locale: string
  currency: string
  legalName: string
  taxId: string
}

// Per-field format checks. Every profile field is optional, so an empty value
// is always valid — only non-empty values are format-checked. Returns the i18n
// key of the error, or null when valid. Fields without an entry never error.
const VALIDATORS: Partial<Record<keyof ProfileFormState, (value: string) => boolean>> = {
  contactEmail: isEmailLike,
  contactPhone: isPhoneLike,
  websiteUrl: isHttpUrlLike,
  instagramUrl: isHttpUrlLike,
  facebookUrl: isHttpUrlLike
}

const ERROR_KEYS: Partial<Record<keyof ProfileFormState, string>> = {
  contactEmail: 'school.settings.errors.email',
  contactPhone: 'school.settings.errors.phone',
  websiteUrl: 'school.settings.errors.url',
  instagramUrl: 'school.settings.errors.url',
  facebookUrl: 'school.settings.errors.url'
}

// Validate only the given section's fields, so saving one card never surfaces
// (or is blocked by) another section's errors. Empty optional fields pass.
export function validateProfileFields(
  fields: readonly (keyof ProfileFormState)[],
  state: ProfileFormState,
  t: (key: string) => string
): FormError[] {
  const errors: FormError[] = []

  for (const name of fields) {
    const raw = state[name]
    if (typeof raw !== 'string' || !raw.trim()) {
      continue
    }
    const isValid = VALIDATORS[name]
    if (isValid && !isValid(raw.trim())) {
      errors.push({ name, message: t(ERROR_KEYS[name] ?? 'school.settings.errors.invalid') })
    }
  }

  return errors
}
