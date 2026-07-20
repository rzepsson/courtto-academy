// Court utilization aggregation — PURE, facility-CORE (product-neutral). It reads
// the core occupancy primitive (reservation intervals + kind), so it serves both
// Academy today and the future Courtto marketplace unchanged: a `booking` row
// counts as usage exactly like a `lesson`, a maintenance/closure block as
// downtime. No Nuxt/Node — luxon only, so it loads in any context and is unit-
// tested directly. The service fetches the rows and the client renders the result.

import { DateTime } from 'luxon'
import { isUsageReservationKind } from './reservation'

export interface UtilizationReservation {
  startsAt: Date
  endsAt: Date
  kind: string
}

export interface OperatingHours {
  open: number
  close: number
}

export interface UtilizationStats {
  // Demand (lesson + booking) minutes within the period.
  usageMinutes: number
  // Maintenance / closure minutes within the period.
  downtimeMinutes: number
  // How many usage reservations touched the period.
  usageCount: number
  // Whole days spanned by [from, to) — the utilization denominator's day factor.
  dayCount: number
  // usage-within-operating-window ÷ (window hours × days), clamped to [0, 100].
  utilizationPct: number
  // Weekday (Mon=0 … Sun=6) × hour (0…23) grid of usage minutes; flat, length 168.
  heatmap: number[]
  // The single busiest weekday×hour cell (drives the heatmap scale + a callout).
  peakBucket: { weekday: number, hour: number, minutes: number } | null
}

const WEEK = 7
const DAY = 24
const MS_PER_MIN = 60_000
const MS_PER_DAY = 86_400_000

function bucketIndex(weekday0: number, hour: number): number {
  return weekday0 * DAY + hour
}

// Distribute one usage interval's minutes across weekday×hour cells in the zone,
// walking hour boundaries so a midnight crossing or DST shift lands in the right
// cell. Usage intervals are short (a lesson), so this stays cheap.
function addToHeatmap(heatmap: number[], startMs: number, endMs: number, timezone: string): void {
  let cursor = DateTime.fromMillis(startMs, { zone: timezone })
  const end = DateTime.fromMillis(endMs, { zone: timezone })
  while (cursor < end) {
    const nextHour = cursor.plus({ hours: 1 }).startOf('hour')
    const segmentEnd = nextHour < end ? nextHour : end
    const minutes = segmentEnd.diff(cursor, 'minutes').minutes
    const index = bucketIndex(cursor.weekday - 1, cursor.hour) // luxon weekday 1=Mon…7=Sun
    heatmap[index] = (heatmap[index] ?? 0) + minutes
    cursor = segmentEnd
  }
}

// One interval's minutes inside [from, to) — a lesson/block straddling the window
// edge only contributes its in-range portion. 0 when it falls entirely outside.
export function clampedMinutes(
  interval: { startsAt: Date, endsAt: Date },
  from: Date,
  to: Date
): number {
  const startMs = Math.max(interval.startsAt.getTime(), from.getTime())
  const endMs = Math.min(interval.endsAt.getTime(), to.getTime())
  return endMs <= startMs ? 0 : (endMs - startMs) / MS_PER_MIN
}

function findPeak(heatmap: number[]): IntervalLoad['peakBucket'] {
  let peak: IntervalLoad['peakBucket'] = null
  for (let weekday = 0; weekday < WEEK; weekday++) {
    for (let hour = 0; hour < DAY; hour++) {
      const minutes = heatmap[bucketIndex(weekday, hour)]!
      if (minutes > 0 && (!peak || minutes > peak.minutes)) {
        peak = { weekday, hour, minutes }
      }
    }
  }
  return peak
}

export interface IntervalLoad {
  // Total in-window minutes across the intervals.
  minutes: number
  // How many intervals touched the window.
  count: number
  // Weekday (Mon=0 … Sun=6) × hour (0…23) grid of minutes; flat, length 168.
  heatmap: number[]
  // The single busiest weekday×hour cell (drives the heatmap scale + a callout).
  peakBucket: { weekday: number, hour: number, minutes: number } | null
}

// The bucketing engine: a set of time intervals → total minutes + a weekday×hour
// grid, clamped to [from, to). Product-neutral time math with exactly one
// implementation, shared by court utilization (occupancy) and per-person Academy
// load (a coach's teaching hours, a student's training hours) — so both read the
// same way and a DST/midnight fix lands once.
export function computeIntervalLoad(
  intervals: { startsAt: Date, endsAt: Date }[],
  timezone: string,
  from: Date,
  to: Date
): IntervalLoad {
  const heatmap = new Array<number>(WEEK * DAY).fill(0)
  let minutes = 0
  let count = 0

  for (const interval of intervals) {
    const inWindow = clampedMinutes(interval, from, to)
    if (inWindow <= 0) continue
    minutes += inWindow
    count += 1
    addToHeatmap(
      heatmap,
      Math.max(interval.startsAt.getTime(), from.getTime()),
      Math.min(interval.endsAt.getTime(), to.getTime()),
      timezone
    )
  }

  return { minutes, count, heatmap, peakBucket: findPeak(heatmap) }
}

export function computeUtilization(
  reservations: UtilizationReservation[],
  timezone: string,
  operating: OperatingHours,
  from: Date,
  to: Date
): UtilizationStats {
  // Usage (demand) drives the heatmap + totals; downtime is counted but never
  // bucketed — it isn't demand.
  const usage = computeIntervalLoad(
    reservations.filter(reservation => isUsageReservationKind(reservation.kind)),
    timezone,
    from,
    to
  )

  let downtimeMinutes = 0
  for (const reservation of reservations) {
    if (!isUsageReservationKind(reservation.kind)) {
      downtimeMinutes += clampedMinutes(reservation, from, to)
    }
  }

  const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY))

  // Utilization numerator: usage minutes inside the operating window only, so the
  // ratio can't exceed 100% (off-hours usage still shows in the heatmap + totals).
  let inWindowMinutes = 0
  for (let weekday = 0; weekday < WEEK; weekday++) {
    for (let hour = operating.open; hour < operating.close; hour++) {
      inWindowMinutes += usage.heatmap[bucketIndex(weekday, hour)]!
    }
  }
  const capacityMinutes = Math.max(0, operating.close - operating.open) * 60 * dayCount
  const utilizationPct = capacityMinutes > 0 ? Math.min(100, (inWindowMinutes / capacityMinutes) * 100) : 0

  return {
    usageMinutes: usage.minutes,
    downtimeMinutes,
    usageCount: usage.count,
    dayCount,
    utilizationPct,
    heatmap: usage.heatmap,
    peakBucket: usage.peakBucket
  }
}
