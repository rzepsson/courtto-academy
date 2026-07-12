import { describe, expect, it } from 'vitest'
import {
  CALENDAR,
  DEFAULT_BAND,
  blockGeometry,
  buildRRule,
  computeBand,
  computeLanes,
  durationMinutes,
  groupSessionsByDay,
  localDayKey,
  localMinutes,
  offsetToMinutes,
  parseRecurrence,
  quarterHourTimes,
  snapMinutes,
  type ScheduleSessionView
} from '../../app/utils/schedule'

const WARSAW = 'Europe/Warsaw'

describe('localMinutes / localDayKey', () => {
  it('resolves an instant to minutes-since-local-midnight in the zone', () => {
    // 15:00Z in summer Warsaw (CEST, +2) = 17:00 local = 1020 min.
    expect(localMinutes('2026-06-01T15:00:00.000Z', WARSAW)).toBe(17 * 60)
    // 23:30Z in summer = 01:30 next day local.
    expect(localMinutes('2026-06-01T23:30:00.000Z', WARSAW)).toBe(90)
  })

  it('resolves the local calendar day', () => {
    expect(localDayKey('2026-06-01T23:30:00.000Z', WARSAW)).toBe('2026-06-02') // 01:30 next day local
    expect(localDayKey('2026-06-01T08:00:00.000Z', WARSAW)).toBe('2026-06-01')
  })
})

describe('blockGeometry', () => {
  it('positions a block within the day band and clamps to edges', () => {
    const bandStart = CALENDAR.dayStartHour * 60
    const first = blockGeometry(bandStart, bandStart + 60) // 07:00–08:00
    expect(first.top).toBe(0)
    expect(first.height).toBe(CALENDAR.pxPerHour)

    // A block starting before the band renders at the top edge.
    const early = blockGeometry(bandStart - 120, bandStart + 30)
    expect(early.top).toBe(0)
    expect(early.height).toBe(CALENDAR.pxPerHour / 2)
  })

  it('enforces a minimum visible height', () => {
    const tiny = blockGeometry(600, 601)
    expect(tiny.height).toBeGreaterThanOrEqual(14)
  })
})

describe('snapMinutes / offsetToMinutes', () => {
  it('snaps to the grid increment', () => {
    expect(snapMinutes(17)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
    expect(snapMinutes(60)).toBe(60)
  })

  it('maps a pixel offset in the band to a snapped minute value', () => {
    expect(offsetToMinutes(0)).toBe(CALENDAR.dayStartHour * 60)
    expect(offsetToMinutes(CALENDAR.pxPerHour)).toBe(CALENDAR.dayStartHour * 60 + 60)
  })
})

describe('durationMinutes', () => {
  it('computes minutes between two instants', () => {
    expect(durationMinutes('2026-06-01T17:00:00.000Z', '2026-06-01T18:30:00.000Z')).toBe(90)
  })
})

describe('buildRRule / parseRecurrence (recurrence round-trip)', () => {
  it('builds supported rules and a one-off', () => {
    expect(buildRRule('none', [], 'MO')).toBeNull()
    expect(buildRRule('daily', [], 'MO')).toBe('FREQ=DAILY')
    expect(buildRRule('monthly', [], 'WE')).toBe('FREQ=MONTHLY')
    expect(buildRRule('weekly', ['MO', 'WE'], 'FR')).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    // Weekly with no chosen day falls back to the start's weekday.
    expect(buildRRule('weekly', [], 'TH')).toBe('FREQ=WEEKLY;BYDAY=TH')
  })

  it('parses stored rules back into the compact controls', () => {
    expect(parseRecurrence(null)).toEqual({ freq: 'none', byday: [] })
    expect(parseRecurrence('FREQ=DAILY')).toEqual({ freq: 'daily', byday: [] })
    expect(parseRecurrence('FREQ=MONTHLY')).toEqual({ freq: 'monthly', byday: [] })
    expect(parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')).toEqual({ freq: 'weekly', byday: ['MO', 'WE'] })
    // Unsupported rule degrades to a one-off.
    expect(parseRecurrence('FREQ=HOURLY')).toEqual({ freq: 'none', byday: [] })
  })

  it('round-trips weekly with explicit days', () => {
    const rrule = buildRRule('weekly', ['TU', 'TH'], 'MO')
    expect(parseRecurrence(rrule)).toEqual({ freq: 'weekly', byday: ['TU', 'TH'] })
  })
})

describe('quarterHourTimes (time picker options)', () => {
  it('lists every 15-min slot across a day, HH:mm zero-padded', () => {
    const times = quarterHourTimes()
    expect(times).toHaveLength(96)
    expect(times[0]).toBe('00:00')
    expect(times[1]).toBe('00:15')
    expect(times.at(-1)).toBe('23:45')
    expect(times).toContain('09:30')
  })
})

describe('computeBand (auto-fit visible hours)', () => {
  const withTimes = (startsAt: string, endsAt: string): ScheduleSessionView =>
    ({ id: startsAt, startsAt, endsAt } as ScheduleSessionView)

  it('keeps the default band when empty or fully inside it', () => {
    expect(computeBand([], WARSAW)).toEqual(DEFAULT_BAND)
    // 17:00–18:00 local (15:00Z summer) is inside 07–23.
    expect(computeBand([withTimes('2026-06-01T15:00:00.000Z', '2026-06-01T16:00:00.000Z')], WARSAW)).toEqual(DEFAULT_BAND)
  })

  it('expands the start for an early lesson', () => {
    // 06:00–07:00 local (04:00Z summer).
    expect(computeBand([withTimes('2026-06-01T04:00:00.000Z', '2026-06-01T05:00:00.000Z')], WARSAW))
      .toEqual({ startHour: 6, endHour: DEFAULT_BAND.endHour })
  })

  it('expands the end for a late lesson, clamped to midnight', () => {
    // 22:00–00:00 local (20:00Z summer, 120 min).
    expect(computeBand([withTimes('2026-06-01T20:00:00.000Z', '2026-06-01T22:00:00.000Z')], WARSAW))
      .toEqual({ startHour: DEFAULT_BAND.startHour, endHour: 24 })
  })
})

describe('groupSessionsByDay (agenda grouping)', () => {
  const at = (startsAt: string): ScheduleSessionView => ({ id: startsAt, startsAt } as ScheduleSessionView)

  it('groups into ascending local days with sessions sorted by start', () => {
    // Given out of order, across two local days (Warsaw, CEST +2).
    const groups = groupSessionsByDay([
      at('2026-06-02T06:00:00.000Z'), // 08:00 local, day 2
      at('2026-06-01T15:00:00.000Z'), // 17:00 local, day 1
      at('2026-06-01T13:00:00.000Z') //  15:00 local, day 1
    ], WARSAW)

    expect(groups.map(g => g.key)).toEqual(['2026-06-01', '2026-06-02'])
    expect(groups[0]!.sessions.map(s => s.startsAt)).toEqual([
      '2026-06-01T13:00:00.000Z',
      '2026-06-01T15:00:00.000Z'
    ])
    expect(groups[1]!.sessions).toHaveLength(1)
  })

  it('returns an empty list for no sessions', () => {
    expect(groupSessionsByDay([], WARSAW)).toEqual([])
  })
})

describe('computeLanes (overlap side-by-side layout)', () => {
  const lanesOf = (intervals: [number, number][]) =>
    computeLanes(intervals, i => i[0], i => i[1]).map(e => ({ start: e.item[0], lane: e.lane, laneCount: e.laneCount }))

  it('gives non-overlapping blocks a single full-width lane', () => {
    const out = lanesOf([[0, 60], [60, 120], [120, 180]])
    expect(out.every(e => e.lane === 0 && e.laneCount === 1)).toBe(true)
  })

  it('treats back-to-back blocks (half-open) as non-overlapping', () => {
    const out = lanesOf([[0, 60], [60, 120]])
    expect(out).toEqual([
      { start: 0, lane: 0, laneCount: 1 },
      { start: 60, lane: 0, laneCount: 1 }
    ])
  })

  it('splits two overlapping blocks into two lanes', () => {
    const out = lanesOf([[0, 60], [30, 90]])
    expect(out[0]).toMatchObject({ lane: 0, laneCount: 2 })
    expect(out[1]).toMatchObject({ lane: 1, laneCount: 2 })
  })

  it('reuses a freed lane within a cluster and shares the cluster lane count', () => {
    // A(0-60), B(30-90), C(70-100): A&B overlap; C overlaps B and reuses A's lane.
    const out = lanesOf([[0, 60], [30, 90], [70, 100]])
    expect(out[0]).toMatchObject({ start: 0, lane: 0, laneCount: 2 })
    expect(out[1]).toMatchObject({ start: 30, lane: 1, laneCount: 2 })
    expect(out[2]).toMatchObject({ start: 70, lane: 0, laneCount: 2 })
  })

  it('handles three concurrent blocks as three lanes', () => {
    const out = lanesOf([[0, 90], [10, 80], [20, 70]])
    expect(new Set(out.map(e => e.lane))).toEqual(new Set([0, 1, 2]))
    expect(out.every(e => e.laneCount === 3)).toBe(true)
  })
})
