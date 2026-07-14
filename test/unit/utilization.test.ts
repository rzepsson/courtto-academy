import { describe, expect, it } from 'vitest'
import { computeUtilization } from '../../shared/utilization'
import { FACILITY_OPERATING_HOURS, isUsageReservationKind } from '../../shared/reservation'
import { formatHours, heatmapCell, heatmapCellClass } from '../../app/utils/utilization'

const WARSAW = 'Europe/Warsaw'
const OPERATING = FACILITY_OPERATING_HOURS

// A Mon–Sun window: [2026-07-13T00:00, 2026-07-20T00:00) local (CEST, +2).
const FROM = new Date('2026-07-12T22:00:00.000Z')
const TO = new Date('2026-07-19T22:00:00.000Z')

// Wed 2026-07-15, 17:00–18:30 local = 15:00–16:30Z.
const lesson = { startsAt: new Date('2026-07-15T15:00:00.000Z'), endsAt: new Date('2026-07-15T16:30:00.000Z'), kind: 'lesson' }

describe('isUsageReservationKind', () => {
  it('treats lesson + booking as usage, blocks as downtime', () => {
    expect(isUsageReservationKind('lesson')).toBe(true)
    expect(isUsageReservationKind('booking')).toBe(true) // the Courtto marketplace seam
    expect(isUsageReservationKind('maintenance')).toBe(false)
    expect(isUsageReservationKind('blocked')).toBe(false)
    expect(isUsageReservationKind('nonsense')).toBe(false)
  })
})

describe('computeUtilization', () => {
  it('returns zeros for no reservations', () => {
    const stats = computeUtilization([], WARSAW, OPERATING, FROM, TO)
    expect(stats.usageMinutes).toBe(0)
    expect(stats.downtimeMinutes).toBe(0)
    expect(stats.usageCount).toBe(0)
    expect(stats.utilizationPct).toBe(0)
    expect(stats.peakBucket).toBeNull()
    expect(stats.heatmap).toHaveLength(168)
  })

  it('buckets a lesson into the right weekday×hour cells (local time)', () => {
    const stats = computeUtilization([lesson], WARSAW, OPERATING, FROM, TO)
    expect(stats.usageMinutes).toBe(90)
    expect(stats.usageCount).toBe(1)
    // Wed = index 2 (Mon=0). 17:00–18:00 → 60 min; 18:00–18:30 → 30 min.
    expect(heatmapCell(stats.heatmap, 2, 17)).toBe(60)
    expect(heatmapCell(stats.heatmap, 2, 18)).toBe(30)
    expect(stats.peakBucket).toEqual({ weekday: 2, hour: 17, minutes: 60 })
    // 90 min of 16h/day × 7 days = 6720 min capacity → ~1.34%.
    expect(stats.utilizationPct).toBeCloseTo(1.339, 2)
  })

  it('counts a block as downtime — not usage, not in the heatmap', () => {
    const block = { startsAt: new Date('2026-07-16T08:00:00.000Z'), endsAt: new Date('2026-07-16T10:00:00.000Z'), kind: 'maintenance' }
    const stats = computeUtilization([lesson, block], WARSAW, OPERATING, FROM, TO)
    expect(stats.usageMinutes).toBe(90)
    expect(stats.downtimeMinutes).toBe(120)
    expect(stats.usageCount).toBe(1)
    // Thu 10:00–12:00 local would be weekday 3, hours 10/11 — but it's downtime, so absent.
    expect(heatmapCell(stats.heatmap, 3, 10)).toBe(0)
  })

  it('counts a marketplace booking as usage (Courtto seam)', () => {
    const booking = { startsAt: new Date('2026-07-14T08:00:00.000Z'), endsAt: new Date('2026-07-14T09:00:00.000Z'), kind: 'booking' }
    const stats = computeUtilization([booking], WARSAW, OPERATING, FROM, TO)
    expect(stats.usageMinutes).toBe(60)
    expect(stats.usageCount).toBe(1)
    expect(heatmapCell(stats.heatmap, 1, 10)).toBe(60) // Tue 10:00 local (08:00Z + 2)
  })

  it('clamps a reservation straddling the window edge to its in-range portion', () => {
    // Starts before FROM: 2026-07-12T21:30Z–22:30Z; only 30 min are ≥ FROM (22:00Z).
    const straddling = { startsAt: new Date('2026-07-12T21:30:00.000Z'), endsAt: new Date('2026-07-12T22:30:00.000Z'), kind: 'lesson' }
    const stats = computeUtilization([straddling], WARSAW, OPERATING, FROM, TO)
    expect(stats.usageMinutes).toBe(30)
  })
})

describe('display helpers', () => {
  it('formats minutes as compact hours', () => {
    expect(formatHours(0)).toBe('0 h')
    expect(formatHours(120)).toBe('2 h')
    expect(formatHours(90)).toBe('1.5 h')
  })

  it('maps a cell to a single-hue sequential class by its share of the peak', () => {
    expect(heatmapCellClass(0, 100)).toBe('bg-elevated')
    expect(heatmapCellClass(10, 100)).toBe('bg-primary/15') // ratio 0.1
    expect(heatmapCellClass(100, 100)).toBe('bg-primary') // the peak cell
    // An empty peak never divides by zero.
    expect(heatmapCellClass(0, 0)).toBe('bg-elevated')
  })
})
