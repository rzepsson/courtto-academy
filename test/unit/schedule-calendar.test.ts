import { describe, expect, it } from 'vitest'
import {
  CALENDAR,
  blockGeometry,
  computeLanes,
  durationMinutes,
  localDayKey,
  localMinutes,
  offsetToMinutes,
  snapMinutes
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
