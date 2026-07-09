import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatJoinCode, formatRelativeTime } from '../../app/utils/format'

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

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-09T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders very recent times as "now"', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 5_000), 'en-US')).toBe('now')
  })

  it('renders minutes and hours ago', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000), 'en-US')).toBe('5 minutes ago')
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 3_600_000), 'en-US')).toBe('3 hours ago')
  })

  it('renders days ago', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000), 'en-US')).toBe('2 days ago')
  })

  it('falls back to an absolute date beyond a week', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 30 * 86_400_000), 'en-US')).toBe('Jun 9, 2026')
  })
})

describe('formatJoinCode', () => {
  it('groups an 8-char code into two blocks of four', () => {
    expect(formatJoinCode('ABCDEFGH')).toBe('ABCD-EFGH')
  })

  it('leaves a short code untouched', () => {
    expect(formatJoinCode('ABC')).toBe('ABC')
    expect(formatJoinCode('ABCD')).toBe('ABCD')
  })
})
