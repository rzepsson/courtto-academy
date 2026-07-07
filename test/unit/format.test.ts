import { describe, expect, it } from 'vitest'
import { formatDate } from '../../app/utils/format'

describe('formatDate', () => {
  const date = new Date('2026-07-07T12:00:00Z')

  it('formats a Date in the given locale', () => {
    expect(formatDate(date, 'en-US')).toBe('Jul 7, 2026')
  })

  it('accepts an ISO string', () => {
    expect(formatDate('2026-07-07T12:00:00Z', 'en-US')).toBe('Jul 7, 2026')
  })

  it('honours the locale', () => {
    // Polish medium format is day-month-year with a trailing dot.
    expect(formatDate(date, 'pl-PL')).toBe('7 lip 2026')
  })

  it('respects a custom dateStyle', () => {
    expect(formatDate(date, 'en-US', 'short')).toBe('7/7/26')
  })
})
