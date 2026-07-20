import { describe, expect, it } from 'vitest'
import { attendanceRate, EMPTY_ATTENDANCE } from '../../shared/member-academy'
import { clampedMinutes, computeIntervalLoad } from '../../shared/utilization'

const ZONE = 'Europe/Warsaw'

function interval(startISO: string, endISO: string) {
  return { startsAt: new Date(startISO), endsAt: new Date(endISO) }
}

describe('attendanceRate', () => {
  it('returns null when nothing has been marked (renders as “—”, not 0%)', () => {
    expect(attendanceRate(EMPTY_ATTENDANCE)).toBeNull()
  })

  it('counts late as turning up', () => {
    expect(attendanceRate({ present: 1, late: 1, absent: 0, excused: 0 })).toBe(100)
  })

  it('excludes excused from both sides, so it is never punitive', () => {
    // 1 present, 1 excused → the excused session simply is not rated.
    expect(attendanceRate({ present: 1, late: 0, absent: 0, excused: 1 })).toBe(100)
    // Excused-only → nothing to rate at all.
    expect(attendanceRate({ present: 0, late: 0, absent: 0, excused: 3 })).toBeNull()
  })

  it('rates misses against expected attendance', () => {
    expect(attendanceRate({ present: 3, late: 0, absent: 1, excused: 0 })).toBe(75)
    expect(attendanceRate({ present: 0, late: 0, absent: 2, excused: 0 })).toBe(0)
  })
})

describe('clampedMinutes', () => {
  const from = new Date('2026-03-02T00:00:00Z')
  const to = new Date('2026-03-03T00:00:00Z')

  it('counts a fully contained interval', () => {
    expect(clampedMinutes(interval('2026-03-02T10:00:00Z', '2026-03-02T11:30:00Z'), from, to)).toBe(90)
  })

  it('counts only the in-window portion of a straddling interval', () => {
    expect(clampedMinutes(interval('2026-03-01T23:00:00Z', '2026-03-02T01:00:00Z'), from, to)).toBe(60)
  })

  it('is zero for an interval entirely outside the window', () => {
    expect(clampedMinutes(interval('2026-03-05T10:00:00Z', '2026-03-05T11:00:00Z'), from, to)).toBe(0)
  })
})

describe('computeIntervalLoad', () => {
  const from = new Date('2026-03-02T00:00:00Z') // Monday
  const to = new Date('2026-03-09T00:00:00Z')

  it('totals minutes and counts only intervals touching the window', () => {
    const load = computeIntervalLoad(
      [
        interval('2026-03-02T09:00:00Z', '2026-03-02T10:00:00Z'),
        interval('2026-03-03T09:00:00Z', '2026-03-03T10:30:00Z'),
        interval('2026-03-20T09:00:00Z', '2026-03-20T10:00:00Z') // outside
      ],
      ZONE,
      from,
      to
    )
    expect(load.minutes).toBe(150)
    expect(load.count).toBe(2)
  })

  it('buckets into a flat weekday×hour grid in the school zone', () => {
    // 09:00 UTC on Mon 2 Mar = 10:00 local (CET, UTC+1) → Monday row, hour 10.
    const load = computeIntervalLoad([interval('2026-03-02T09:00:00Z', '2026-03-02T10:00:00Z')], ZONE, from, to)
    expect(load.heatmap).toHaveLength(168)
    expect(load.heatmap[0 * 24 + 10]).toBe(60)
    expect(load.peakBucket).toEqual({ weekday: 0, hour: 10, minutes: 60 })
  })

  it('splits an interval across the hour boundaries it spans', () => {
    // 10:30–12:00 local → 30 min in hour 10, 60 in hour 11.
    const load = computeIntervalLoad([interval('2026-03-02T09:30:00Z', '2026-03-02T11:00:00Z')], ZONE, from, to)
    expect(load.heatmap[0 * 24 + 10]).toBe(30)
    expect(load.heatmap[0 * 24 + 11]).toBe(60)
  })

  it('has no peak and an empty grid with no intervals', () => {
    const load = computeIntervalLoad([], ZONE, from, to)
    expect(load.minutes).toBe(0)
    expect(load.count).toBe(0)
    expect(load.peakBucket).toBeNull()
    expect(load.heatmap.every(cell => cell === 0)).toBe(true)
  })
})
