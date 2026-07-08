// Builds the option lists for the regional selects (time zone, currency,
// country) from the platform's Intl data instead of hand-maintained tables, so
// they stay correct and localize to the active UI language. Results are
// memoized — the underlying data never changes within a session.

export interface SelectOption {
  label: string
  value: string
}

// `Intl.supportedValuesOf` isn't in every TS lib target; access it defensively.
type IntlWithValues = typeof Intl & { supportedValuesOf?: (key: string) => string[] }

function supportedValues(key: string): string[] {
  return (Intl as IntlWithValues).supportedValuesOf?.(key) ?? []
}

function byLabel(a: SelectOption, b: SelectOption): number {
  return a.label.localeCompare(b.label)
}

let timezoneCache: SelectOption[] | null = null

export function timezoneOptions(): SelectOption[] {
  if (timezoneCache) {
    return timezoneCache
  }
  const zones = supportedValues('timeZone')
  const list = zones.length ? zones : ['Europe/Warsaw', 'UTC']
  timezoneCache = list.map(zone => ({ value: zone, label: zone.replace(/_/g, ' ') })).sort(byLabel)
  return timezoneCache
}

const currencyCache = new Map<string, SelectOption[]>()

export function currencyOptions(locale: string): SelectOption[] {
  const cached = currencyCache.get(locale)
  if (cached) {
    return cached
  }
  const names = new Intl.DisplayNames([locale], { type: 'currency' })
  const codes = supportedValues('currency')
  const list = (codes.length ? codes : ['PLN', 'EUR', 'USD', 'GBP'])
    .map(code => ({ value: code, label: `${names.of(code) ?? code} (${code})` }))
    .sort(byLabel)
  currencyCache.set(locale, list)
  return list
}

const countryCache = new Map<string, SelectOption[]>()

export function countryOptions(locale: string): SelectOption[] {
  const cached = countryCache.get(locale)
  if (cached) {
    return cached
  }
  // Intl has no "list of regions", so enumerate all AA–ZZ pairs and keep the
  // ones Intl recognizes (fallback 'none' → undefined for invalid codes).
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
  const list: SelectOption[] = []
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      const name = names.of(code)
      if (name && name !== code) {
        list.push({ value: code, label: name })
      }
    }
  }
  list.sort(byLabel)
  countryCache.set(locale, list)
  return list
}
