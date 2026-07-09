import { describe, expect, it } from 'vitest'
import {
  COUNTRY_CURRENCY,
  REGIONAL_FALLBACK,
  TIMEZONE_COUNTRY,
  deriveRegionalDefaults
} from '../../shared/regional'

describe('deriveRegionalDefaults', () => {
  it('derives a Polish browser to the launch-market defaults', () => {
    expect(deriveRegionalDefaults({ timezone: 'Europe/Warsaw', language: 'pl-PL' })).toEqual({
      country: 'PL',
      timezone: 'Europe/Warsaw',
      currency: 'PLN',
      locale: 'pl'
    })
  })

  it('derives a German browser to DE / EUR, English notifications (de unsupported)', () => {
    expect(deriveRegionalDefaults({ timezone: 'Europe/Berlin', language: 'de-DE' })).toEqual({
      country: 'DE',
      timezone: 'Europe/Berlin',
      currency: 'EUR',
      locale: 'en'
    })
  })

  it('derives a US browser to US / USD / en', () => {
    expect(deriveRegionalDefaults({ timezone: 'America/New_York', language: 'en-US' })).toEqual({
      country: 'US',
      timezone: 'America/New_York',
      currency: 'USD',
      locale: 'en'
    })
  })

  it('falls back to the language region subtag when the zone is unknown', () => {
    // A valid-but-unmapped zone: keep the zone, take the country from language.
    const result = deriveRegionalDefaults({ timezone: 'Indian/Mauritius', language: 'fr-FR' })
    expect(result.timezone).toBe('Indian/Mauritius')
    expect(result.country).toBe('FR')
    expect(result.currency).toBe('EUR')
    expect(result.locale).toBe('en')
  })

  it('uses the fallback country/currency when neither zone nor language region resolves', () => {
    expect(deriveRegionalDefaults({ timezone: 'Indian/Mauritius', language: 'en' })).toEqual({
      country: REGIONAL_FALLBACK.country,
      timezone: 'Indian/Mauritius',
      currency: REGIONAL_FALLBACK.currency,
      locale: 'en'
    })
  })

  it('ignores an invalid time zone and uses the fallback zone', () => {
    const result = deriveRegionalDefaults({ timezone: 'Not/AZone', language: 'pl-PL' })
    expect(result.timezone).toBe(REGIONAL_FALLBACK.timezone)
    expect(result.country).toBe('PL') // country derived from the fallback zone (Europe/Warsaw → PL)
  })

  it('returns the full fallback when nothing is provided', () => {
    expect(deriveRegionalDefaults({})).toEqual({ ...REGIONAL_FALLBACK })
  })

  it('honours the primary language subtag regardless of case/region', () => {
    expect(deriveRegionalDefaults({ language: 'PL' }).locale).toBe('pl')
    expect(deriveRegionalDefaults({ language: 'en-GB' }).locale).toBe('en')
  })
})

describe('regional data tables', () => {
  it('has a currency for every country referenced by a time zone', () => {
    for (const country of Object.values(TIMEZONE_COUNTRY)) {
      expect(COUNTRY_CURRENCY[country], `missing currency for ${country}`).toBeDefined()
    }
  })

  it('maps every time zone to a valid IANA identifier', () => {
    for (const zone of Object.keys(TIMEZONE_COUNTRY)) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow()
    }
  })
})
