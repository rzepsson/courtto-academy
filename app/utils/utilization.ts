import { Info } from 'luxon'
import type { CourtUtilizationDto } from '~~/server/database/types'

// Client-facing utilization: over HTTP the Date columns arrive as ISO strings, so
// the panel binds against this string-dated shape (mirrors CourtView). Pure
// display helpers live here too, so they're unit-tested and shared.

export type CourtUtilizationView = Omit<CourtUtilizationDto, 'from' | 'to'> & {
  from: string
  to: string
}

// Minutes → a compact hours label ("42.5 h", "8 h", "0 h").
export function formatHours(minutes: number): string {
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

// Sequential single-hue ramp (brand green) for a heatmap cell, keyed by the
// cell's share of the busiest cell. Static Tailwind classes → theme-aware, and
// CVD-safe by construction (one hue, rising opacity). 0 = a neutral surface.
export function heatmapCellClass(minutes: number, peakMinutes: number): string {
  if (minutes <= 0 || peakMinutes <= 0) return 'bg-elevated'
  const ratio = minutes / peakMinutes
  if (ratio <= 0.2) return 'bg-primary/15'
  if (ratio <= 0.4) return 'bg-primary/30'
  if (ratio <= 0.6) return 'bg-primary/55'
  if (ratio <= 0.8) return 'bg-primary/75'
  return 'bg-primary'
}

// The usage minutes in one weekday×hour cell of the flat 168-length heatmap.
export function heatmapCell(heatmap: number[], weekday: number, hour: number): number {
  return heatmap[weekday * 24 + hour] ?? 0
}

// Localized short weekday names, Monday-first (matches the heatmap's row order).
export function weekdayLabels(locale: string): string[] {
  return Info.weekdays('short', { locale })
}
