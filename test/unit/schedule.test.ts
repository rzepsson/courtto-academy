import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import {
  expandOccurrences,
  isAttendanceStatus,
  isCapacityRangeValid,
  isEnrollmentStatus,
  isLessonType,
  isSessionStatus,
  isSupportedRecurrence,
  isValidLocalDateTime,
  isValidRRule,
  localDateTimeToInstant
} from '../../shared/schedule'
import {
  isReservationKind,
  isReservationStatus,
  rangesOverlap
} from '../../shared/reservation'
import {
  scheduleSeriesCreateSchema,
  scheduleSeriesPatchSchema,
  sessionUpdateSchema
} from '../../shared/schedule-schema'

// Identity resolver: error messages are the raw codes, so tests assert on them.
const raw = (code: string) => code

const WARSAW = 'Europe/Warsaw'
const localHourIn = (instant: Date, zone: string) => DateTime.fromJSDate(instant, { zone }).hour

describe('enum guards', () => {
  it('validates reservation status / kind', () => {
    expect(isReservationStatus('confirmed')).toBe(true)
    expect(isReservationStatus('deleted')).toBe(false)
    expect(isReservationKind('lesson')).toBe(true)
    expect(isReservationKind('maintenance')).toBe(true)
    expect(isReservationKind('party')).toBe(false)
  })

  it('validates lesson type as nature only (no "single" — recurrence is orthogonal)', () => {
    expect(isLessonType('group')).toBe(true)
    expect(isLessonType('individual')).toBe(true)
    expect(isLessonType('open')).toBe(true)
    expect(isLessonType('single')).toBe(false)
  })

  it('validates session / enrollment / attendance statuses', () => {
    expect(isSessionStatus('scheduled')).toBe(true)
    expect(isSessionStatus('rescheduled')).toBe(true)
    expect(isSessionStatus('deleted')).toBe(false)
    expect(isEnrollmentStatus('waitlisted')).toBe(true)
    expect(isEnrollmentStatus('maybe')).toBe(false)
    expect(isAttendanceStatus('excused')).toBe(true)
    expect(isAttendanceStatus('late')).toBe(true)
    expect(isAttendanceStatus('present')).toBe(true)
    expect(isAttendanceStatus('ghosted')).toBe(false)
  })
})

describe('isValidLocalDateTime', () => {
  it('accepts a well-formed real date-time', () => {
    expect(isValidLocalDateTime('2026-09-01T17:00')).toBe(true)
    expect(isValidLocalDateTime('2026-02-28T00:00')).toBe(true)
  })

  it('rejects bad formats and impossible dates', () => {
    expect(isValidLocalDateTime('2026-09-01 17:00')).toBe(false) // space, not T
    expect(isValidLocalDateTime('2026-9-1T17:00')).toBe(false) // unpadded
    expect(isValidLocalDateTime('2026-02-30T10:00')).toBe(false) // no Feb 30
    expect(isValidLocalDateTime('2026-13-01T10:00')).toBe(false) // month 13
    expect(isValidLocalDateTime('2026-09-01T25:00')).toBe(false) // hour 25
    expect(isValidLocalDateTime('nope')).toBe(false)
    expect(isValidLocalDateTime('')).toBe(false)
  })
})

describe('localDateTimeToInstant', () => {
  it('resolves a wall-clock time to the correct UTC instant per DST offset', () => {
    // Winter (CET, UTC+1): 12:00 local → 11:00 UTC.
    expect(localDateTimeToInstant('2026-01-15T12:00', WARSAW).getUTCHours()).toBe(11)
    // Summer (CEST, UTC+2): 12:00 local → 10:00 UTC.
    expect(localDateTimeToInstant('2026-07-15T12:00', WARSAW).getUTCHours()).toBe(10)
  })

  it('throws on an impossible date instead of returning a NaN instant', () => {
    expect(() => localDateTimeToInstant('2026-02-30T10:00', WARSAW)).toThrow()
    expect(() => localDateTimeToInstant('bad', WARSAW)).toThrow()
  })
})

describe('isValidRRule', () => {
  it('accepts parseable RFC 5545 rules, with or without the RRULE: prefix', () => {
    expect(isValidRRule('FREQ=WEEKLY;BYDAY=MO')).toBe(true)
    expect(isValidRRule('RRULE:FREQ=DAILY')).toBe(true)
    expect(isValidRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1;COUNT=10')).toBe(true)
  })

  it('rejects rules with no frequency or garbage', () => {
    expect(isValidRRule('BYDAY=MO')).toBe(false) // no FREQ
    expect(isValidRRule('FREQ=BOGUS')).toBe(false)
    expect(isValidRRule('hello')).toBe(false)
    expect(isValidRRule('')).toBe(false)
  })
})

describe('isSupportedRecurrence', () => {
  it('accepts daily-or-coarser frequencies', () => {
    expect(isSupportedRecurrence('FREQ=DAILY')).toBe(true)
    expect(isSupportedRecurrence('FREQ=WEEKLY;BYDAY=MO')).toBe(true)
    expect(isSupportedRecurrence('FREQ=MONTHLY')).toBe(true)
    expect(isSupportedRecurrence('FREQ=YEARLY')).toBe(true)
  })

  it('rejects sub-daily frequencies (they self-overlap and fan out)', () => {
    expect(isSupportedRecurrence('FREQ=HOURLY')).toBe(false)
    expect(isSupportedRecurrence('FREQ=MINUTELY')).toBe(false)
    expect(isSupportedRecurrence('FREQ=SECONDLY')).toBe(false)
    expect(isSupportedRecurrence('nonsense')).toBe(false)
  })
})

describe('rangesOverlap (half-open [start, end))', () => {
  const at = (iso: string) => new Date(iso)

  it('detects true overlap', () => {
    expect(rangesOverlap(
      at('2026-09-01T10:00:00Z'), at('2026-09-01T11:00:00Z'),
      at('2026-09-01T10:30:00Z'), at('2026-09-01T11:30:00Z')
    )).toBe(true)
  })

  it('treats back-to-back ranges as NOT overlapping', () => {
    expect(rangesOverlap(
      at('2026-09-01T10:00:00Z'), at('2026-09-01T11:00:00Z'),
      at('2026-09-01T11:00:00Z'), at('2026-09-01T12:00:00Z')
    )).toBe(false)
  })

  it('detects disjoint ranges', () => {
    expect(rangesOverlap(
      at('2026-09-01T10:00:00Z'), at('2026-09-01T11:00:00Z'),
      at('2026-09-01T13:00:00Z'), at('2026-09-01T14:00:00Z')
    )).toBe(false)
  })
})

describe('isCapacityRangeValid', () => {
  it('is permissive when either bound is absent', () => {
    expect(isCapacityRangeValid(null, 5)).toBe(true)
    expect(isCapacityRangeValid(5, null)).toBe(true)
    expect(isCapacityRangeValid(undefined, undefined)).toBe(true)
  })
  it('requires min <= max when both present', () => {
    expect(isCapacityRangeValid(2, 5)).toBe(true)
    expect(isCapacityRangeValid(5, 5)).toBe(true)
    expect(isCapacityRangeValid(6, 5)).toBe(false)
  })
})

describe('expandOccurrences — single (no rrule)', () => {
  it('yields exactly one occurrence when it falls in the window', () => {
    const occ = expandOccurrences({
      dtStart: '2026-06-01T10:00',
      timezone: WARSAW,
      durationMin: 90,
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-06-02T00:00:00Z')
    })
    expect(occ).toHaveLength(1)
    expect(localHourIn(occ[0]!.startsAt, WARSAW)).toBe(10)
    expect(occ[0]!.endsAt.getTime() - occ[0]!.startsAt.getTime()).toBe(90 * 60_000)
    // The anchor equals the start for a freshly expanded occurrence.
    expect(occ[0]!.occurrenceStart.getTime()).toBe(occ[0]!.startsAt.getTime())
  })

  it('yields nothing when the single occurrence is outside the window', () => {
    const occ = expandOccurrences({
      dtStart: '2026-06-01T10:00',
      timezone: WARSAW,
      durationMin: 90,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z')
    })
    expect(occ).toHaveLength(0)
  })
})

describe('expandOccurrences — recurrence', () => {
  it('honours COUNT', () => {
    const occ = expandOccurrences({
      dtStart: '2026-09-07T17:00',
      timezone: WARSAW,
      durationMin: 60,
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2027-01-01T00:00:00Z')
    })
    expect(occ).toHaveLength(3)
  })

  it('applies UNTIL in the series timezone, not raw UTC', () => {
    // Daily 10:00 Warsaw (CEST = UTC+2 → 08:00Z). UNTIL 08:30Z is AFTER the
    // Jul-1 start instant (08:00Z), so Jul 1 must be included and Jul 2 excluded.
    // A naive floating-vs-absolute compare (10:00 floating > 08:30Z) would
    // wrongly drop Jul 1 → zero occurrences.
    const occ = expandOccurrences({
      dtStart: '2026-07-01T10:00',
      timezone: WARSAW,
      durationMin: 60,
      rrule: 'FREQ=DAILY;UNTIL=20260701T083000Z',
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z')
    })
    expect(occ).toHaveLength(1)
    expect(localHourIn(occ[0]!.startsAt, WARSAW)).toBe(10)
  })

  it('respects the safety max cap', () => {
    const occ = expandOccurrences({
      dtStart: '2026-01-01T08:00',
      timezone: WARSAW,
      durationMin: 30,
      rrule: 'FREQ=DAILY',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-12-31T00:00:00Z'),
      max: 10
    })
    expect(occ).toHaveLength(10)
  })

  it('filters to the requested window', () => {
    const occ = expandOccurrences({
      dtStart: '2026-01-05T18:00',
      timezone: WARSAW,
      durationMin: 60,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-04-01T00:00:00Z')
    })
    // Every occurrence is a Monday inside March 2026.
    expect(occ.length).toBeGreaterThanOrEqual(4)
    for (const o of occ) {
      const local = DateTime.fromJSDate(o.startsAt, { zone: WARSAW })
      expect(local.weekday).toBe(1) // Monday
      expect(local.month).toBe(3)
    }
  })
})

describe('expandOccurrences — DST correctness (the whole point)', () => {
  it('keeps "every Monday 17:00" at 17:00 local across the spring transition', () => {
    // Warsaw switches CET→CEST on the last Sunday of March 2026 (Mar 29).
    const occ = expandOccurrences({
      dtStart: '2026-03-02T17:00',
      timezone: WARSAW,
      durationMin: 60,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-05-01T00:00:00Z')
    })
    expect(occ.length).toBeGreaterThan(4)

    // Wall-clock stays 17:00 for EVERY occurrence — no drift.
    for (const o of occ) {
      expect(localHourIn(o.startsAt, WARSAW)).toBe(17)
      expect(DateTime.fromJSDate(o.startsAt, { zone: WARSAW }).minute).toBe(0)
    }

    // The absolute UTC instant shifts across the boundary: 17:00 CET = 16:00Z,
    // 17:00 CEST = 15:00Z. Both must appear, proving the transition was handled.
    const utcHours = new Set(occ.map(o => o.startsAt.getUTCHours()))
    expect(utcHours.has(16)).toBe(true) // before DST (winter, UTC+1)
    expect(utcHours.has(15)).toBe(true) // after DST (summer, UTC+2)
  })
})

describe('scheduleSeriesCreateSchema (rules-based)', () => {
  const schema = scheduleSeriesCreateSchema(raw)
  const rule = (over: Record<string, unknown> = {}) => ({ dtStart: '2026-09-01T17:00', durationMin: 60, courtId: 'court-1', ...over })

  it('accepts a minimal group with one rule; timezone optional, defaults are the service’s job', () => {
    const result = schema.parse({ type: 'group', sport: 'tennis', title: 'Grupa A', rules: [rule()] })
    expect(result.type).toBe('group')
    expect(result.title).toBe('Grupa A')
    expect(result.rules[0]!.courtId).toBe('court-1')
    // timezone omitted is allowed — the service snapshots orgProfile.timezone.
    expect(result.timezone).toBeUndefined()
    // No Zod defaults, so `.partial()` can't resurrect them on a PATCH.
    expect(result.color).toBeUndefined()
    expect(result.visibility).toBeUndefined()
    expect(result.enrollmentOpen).toBeUndefined()
  })

  it('requires at least one rule, each with a court', () => {
    expect(schema.safeParse({ type: 'group', sport: 'tennis', title: 'A', rules: [] }).success).toBe(false)
    expect(schema.safeParse({
      type: 'group', sport: 'tennis', title: 'A', rules: [{ dtStart: '2026-09-01T17:00', durationMin: 60 }]
    }).success).toBe(false)
  })

  it('accepts multiple rules — one group meeting on several day/time slots', () => {
    const result = schema.parse({
      type: 'group', sport: 'tennis', title: 'A', rules: [
        rule({ rrule: 'FREQ=WEEKLY;BYDAY=WE', dtStart: '2026-09-02T15:00' }),
        rule({ rrule: 'FREQ=WEEKLY;BYDAY=TH', dtStart: '2026-09-03T13:00', durationMin: 90, courtId: 'court-2' })
      ]
    })
    expect(result.rules).toHaveLength(2)
    expect(result.rules[1]!.durationMin).toBe(90)
    expect(result.rules[1]!.courtId).toBe('court-2')
  })

  it('rejects a bad type, sport, colour, and per-rule duration/dtStart', () => {
    const good = { type: 'group', sport: 'tennis', title: 'A', rules: [rule()] }
    expect(schema.safeParse({ ...good, type: 'single' }).success).toBe(false)
    expect(schema.safeParse({ ...good, sport: 'golf' }).success).toBe(false)
    expect(schema.safeParse({ ...good, color: 'blue' }).success).toBe(false)
    expect(schema.safeParse({ ...good, rules: [rule({ durationMin: 0 })] }).success).toBe(false)
    expect(schema.safeParse({ ...good, rules: [rule({ durationMin: 5000 })] }).success).toBe(false)
    expect(schema.safeParse({ ...good, rules: [rule({ dtStart: 'nope' })] }).success).toBe(false)
    expect(schema.safeParse({ ...good, title: '   ' }).success).toBe(false)
  })

  it('validates a rule rrule when present, rejects sub-daily, and collapses an empty one to null', () => {
    const good = { type: 'group', sport: 'tennis', title: 'A' }
    expect(schema.safeParse({ ...good, rules: [rule({ rrule: 'FREQ=BOGUS' })] }).success).toBe(false)
    expect(schema.safeParse({ ...good, rules: [rule({ rrule: 'FREQ=HOURLY' })] }).success).toBe(false) // sub-daily rejected
    expect(schema.parse({ ...good, rules: [rule({ rrule: 'FREQ=WEEKLY;BYDAY=MO' })] }).rules[0]!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(schema.parse({ ...good, rules: [rule({ rrule: '' })] }).rules[0]!.rrule).toBeNull()
  })

  it('accepts a valid hex colour', () => {
    const result = schema.parse({ type: 'group', sport: 'tennis', title: 'A', color: '#2f6db5', rules: [rule()] })
    expect(result.color).toBe('#2f6db5')
  })
})

describe('scheduleSeriesPatchSchema', () => {
  const schema = scheduleSeriesPatchSchema(raw)

  it('validates only the keys present, without injecting defaults', () => {
    const result = schema.parse({ title: 'Renamed' })
    expect(result.title).toBe('Renamed')
    expect(result.type).toBeUndefined()
    expect(result.durationMin).toBeUndefined()
  })

  it('still rejects an invalid value when its key is present', () => {
    expect(schema.safeParse({ durationMin: 3 }).success).toBe(false)
    expect(schema.safeParse({ type: 'squad' }).success).toBe(false)
    expect(schema.safeParse({ title: '' }).success).toBe(false)
  })
})

describe('sessionUpdateSchema (single-occurrence edit)', () => {
  const schema = sessionUpdateSchema(raw)

  it('accepts an empty patch (everything optional = keep)', () => {
    expect(schema.parse({})).toEqual({})
  })

  it('validates a new wall-clock time and duration bounds', () => {
    expect(schema.parse({ startsAt: '2026-09-07T18:30' }).startsAt).toBe('2026-09-07T18:30')
    expect(schema.safeParse({ startsAt: 'nope' }).success).toBe(false)
    expect(schema.safeParse({ durationMin: 3 }).success).toBe(false)
    expect(schema.safeParse({ durationMin: 5000 }).success).toBe(false)
  })

  it('lets a court be changed but not cleared, and a coach be cleared to null', () => {
    expect(schema.parse({ courtId: 'court-9' }).courtId).toBe('court-9')
    expect(schema.safeParse({ courtId: '' }).success).toBe(false) // a session always has a court
    expect(schema.parse({ coachMemberId: '' }).coachMemberId).toBeNull() // clears the coach (open court)
    expect(schema.parse({ coachMemberId: 'm-1' }).coachMemberId).toBe('m-1')
  })
})
