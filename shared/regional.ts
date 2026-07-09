// Derives a school's initial regional settings (country / timezone / currency /
// notification locale) from zero-permission browser signals — the IANA time zone
// (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and `navigator.language`.
// Pure and dependency-free (like shared/org-profile.ts) so it loads in any
// context and is the single source of truth shared by the onboarding seeder and
// the server-side profile defaults. No `navigator.geolocation` / GPS involved.

import { PROFILE_LOCALES, type ProfileLocale } from './org-profile'

// Ultimate fallback when nothing can be detected (e.g. an org created via the
// API with no browser signal). Poland-first — the launch market. Also reused as
// the regional part of the server's PROFILE_DEFAULTS.
export const REGIONAL_FALLBACK = {
  country: 'PL',
  timezone: 'Europe/Warsaw',
  currency: 'PLN',
  locale: 'pl'
} as const satisfies RegionalDefaults

// The international default UI language, mirroring nuxt.config's i18n
// `defaultLocale` — used when the browser language is known but unsupported
// (e.g. a German browser gets English notifications, not Polish).
const DEFAULT_UI_LOCALE: ProfileLocale = 'en'

export interface RegionalDefaults {
  country: string // ISO 3166-1 alpha-2
  timezone: string // IANA
  currency: string // ISO 4217
  locale: ProfileLocale
}

// Curated IANA time zone → ISO country for the realistic markets. Anything not
// here falls back to the language region subtag, then REGIONAL_FALLBACK, so the
// table only needs the common zones — extend it as new markets appear.
export const TIMEZONE_COUNTRY: Record<string, string> = {
  'Europe/Warsaw': 'PL',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT',
  'Europe/Lisbon': 'PT',
  'Europe/Dublin': 'IE',
  'Europe/Helsinki': 'FI',
  'Europe/Athens': 'GR',
  'Europe/Bratislava': 'SK',
  'Europe/Ljubljana': 'SI',
  'Europe/Luxembourg': 'LU',
  'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT',
  'Europe/Tallinn': 'EE',
  'Europe/Nicosia': 'CY',
  'Europe/Malta': 'MT',
  'Europe/Zagreb': 'HR',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG',
  'Europe/Stockholm': 'SE',
  'Europe/Copenhagen': 'DK',
  'Europe/Oslo': 'NO',
  'Europe/London': 'GB',
  'Europe/Zurich': 'CH',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA', // legacy alias some browsers still report
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA',
  'America/Winnipeg': 'CA',
  'America/Edmonton': 'CA',
  'America/Vancouver': 'CA',
  'America/Halifax': 'CA',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Adelaide': 'AU',
  'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ'
}

// ISO country → ISO 4217 currency for the same markets. Countries not listed
// fall back to REGIONAL_FALLBACK.currency.
export const COUNTRY_CURRENCY: Record<string, string> = {
  PL: 'PLN',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR',
  PT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR', LU: 'EUR',
  LV: 'EUR', LT: 'EUR', EE: 'EUR', CY: 'EUR', MT: 'EUR', HR: 'EUR',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BG: 'BGN',
  SE: 'SEK',
  DK: 'DKK',
  NO: 'NOK',
  GB: 'GBP',
  CH: 'CHF',
  UA: 'UAH',
  US: 'USD',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD'
}

// Whether the runtime's Intl recognizes this IANA zone. Shared with the server
// PATCH normalization so client and server agree on what a valid zone is.
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// The region subtag of a BCP-47 tag, e.g. 'pl-PL' → 'PL', 'en' → undefined.
function regionOf(language: string | undefined): string | undefined {
  const parts = language?.split('-') ?? []
  const region = parts[1]
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : undefined
}

// The notification language: the browser's primary subtag if we support it,
// else English when a language is known, else the fallback (no signal at all).
function pickLocale(language: string | undefined): ProfileLocale {
  if (!language) {
    return REGIONAL_FALLBACK.locale
  }
  const base = language.toLowerCase().split('-')[0] ?? ''
  return (PROFILE_LOCALES as readonly string[]).includes(base) ? (base as ProfileLocale) : DEFAULT_UI_LOCALE
}

// Turn raw browser signals into a complete, validated set of regional defaults.
// Every field degrades independently to REGIONAL_FALLBACK, so partial or unknown
// input still yields a usable result.
export function deriveRegionalDefaults(input: { timezone?: string, language?: string }): RegionalDefaults {
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : REGIONAL_FALLBACK.timezone
  const country = TIMEZONE_COUNTRY[timezone] ?? regionOf(input.language) ?? REGIONAL_FALLBACK.country
  const currency = COUNTRY_CURRENCY[country] ?? REGIONAL_FALLBACK.currency
  const locale = pickLocale(input.language)

  return { country, timezone, currency, locale }
}
