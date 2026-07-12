import { DateTime } from 'luxon'
import type { ScheduleSessionDto, LessonSessionDto, LessonSeriesDto, StudentSessionView } from '~~/server/database/types'
import { LESSON_TYPES } from '~~/shared/schedule'
import { scheduleSeriesSchema, type ScheduleErrorCode } from '~~/shared/schedule-schema'

// Client-facing schedule domain: re-exports of the shared schedule constants,
// the string-dated view types, the form↔schema binding, and the pure grid/time
// math the calendar renders with. app/utils/* is auto-imported (mirrors
// app/utils/courts.ts), so pages/components use these without importing ~~/shared.

export { LESSON_TYPES, LESSON_COLOR_PRESETS, DEFAULT_LESSON_COLOR } from '~~/shared/schedule'
export type { LessonType } from '~~/shared/schedule'

// Over HTTP the Date columns arrive JSON-serialized as ISO strings, so the
// calendar binds against these string-dated shapes, not the server DTOs.
export type ScheduleSessionView = Omit<ScheduleSessionDto, 'startsAt' | 'endsAt' | 'occurrenceStart'> & {
  startsAt: string
  endsAt: string
  occurrenceStart: string
}

export type StudentSessionViewClient = Omit<StudentSessionView, 'startsAt' | 'endsAt' | 'occurrenceStart'> & {
  startsAt: string
  endsAt: string
  occurrenceStart: string
}

export type LessonSessionDetail = Omit<LessonSessionDto, 'startsAt' | 'endsAt' | 'occurrenceStart'> & {
  startsAt: string
  endsAt: string
  occurrenceStart: string
}

export type LessonSeriesDetail = Omit<LessonSeriesDto, 'materializedUntil' | 'createdAt'> & {
  materializedUntil: string | null
  createdAt: string
}

// ── Form ↔ shared schema binding ─────────────────────────────────────────────

const SCHEDULE_ERROR_KEYS: Record<ScheduleErrorCode, string> = {
  required: 'schedule.form.errors.required',
  tooLong: 'schedule.form.errors.tooLong',
  type: 'schedule.form.errors.invalid',
  sport: 'schedule.form.errors.invalid',
  color: 'schedule.form.errors.color',
  timezone: 'schedule.form.errors.invalid',
  rrule: 'schedule.form.errors.rrule',
  dtStart: 'schedule.form.errors.dtStart',
  duration: 'schedule.form.errors.duration',
  capacity: 'schedule.form.errors.capacity',
  visibility: 'schedule.form.errors.invalid'
}

// The builder binds this to `UForm :schema` — the same shared schema the server
// validates against. Rebuilt per-locale (call inside a computed).
export function scheduleFormSchema(t: (key: string) => string) {
  return scheduleSeriesSchema(code => t(SCHEDULE_ERROR_KEYS[code]))
}

export function lessonTypeOptions(t: (key: string) => string): { value: string, label: string }[] {
  return LESSON_TYPES.map(value => ({ value, label: t(`schedule.types.${value}`) }))
}

// Sentinel for the "no coach" select option. Reka's USelect throws on an item
// whose value is the empty string (that value is reserved for clearing the
// selection), so the optional-coach picker uses this token and the form maps it
// back to "omit / clear" on submit.
export const NO_COACH_VALUE = '__none__'

// The optional-coach picker's options: the sentinel "no coach" entry first, then
// the facility's coaches. Shared by the create form and the reschedule slideover.
export function coachSelectOptions(
  coaches: { id: string, name: string }[],
  noCoachLabel: string
): { value: string, label: string }[] {
  return [{ value: NO_COACH_VALUE, label: noCoachLabel }, ...coaches.map(c => ({ value: c.id, label: c.name }))]
}

// ── Grid / time math (pure) ──────────────────────────────────────────────────

// The visible time band on the day/week grid, and the pixel scale. Kept generous
// enough for early-morning and late-evening lessons without endless scroll.
export const CALENDAR = {
  dayStartHour: 7,
  dayEndHour: 23,
  pxPerHour: 64,
  snapMinutes: 15
} as const

// Minimum block height so a very short (or clamped-to-edge) lesson stays clickable.
const MIN_BLOCK_PX = 16

export function gridMinutes(): number {
  return (CALENDAR.dayEndHour - CALENDAR.dayStartHour) * 60
}

export function gridHeightPx(): number {
  return (CALENDAR.dayEndHour - CALENDAR.dayStartHour) * CALENDAR.pxPerHour
}

// Minutes since local midnight for an instant, in the given IANA zone.
export function localMinutes(iso: string, timezone: string): number {
  const dt = DateTime.fromISO(iso, { zone: timezone })
  return dt.hour * 60 + dt.minute
}

// The local calendar day ('yyyy-MM-dd') an instant falls on, in the zone.
export function localDayKey(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat('yyyy-MM-dd')
}

// A block's top/height in pixels within the day band. Clamped so a block that
// starts before / ends after the visible band — or exactly at the band end —
// still renders a visible, clickable sliver at the edge rather than off-grid.
export function blockGeometry(startMin: number, endMin: number): { top: number, height: number } {
  const bandStart = CALENDAR.dayStartHour * 60
  const bandEnd = CALENDAR.dayEndHour * 60
  const maxTop = gridHeightPx() - MIN_BLOCK_PX
  const top = Math.min(Math.max((Math.max(startMin, bandStart) - bandStart) / 60 * CALENDAR.pxPerHour, 0), maxTop)
  const bottom = (Math.min(endMin, bandEnd) - bandStart) / 60 * CALENDAR.pxPerHour
  return { top, height: Math.max(bottom - top, MIN_BLOCK_PX) }
}

// Snap a minute value to the grid (e.g. 15-min increments).
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / CALENDAR.snapMinutes) * CALENDAR.snapMinutes
}

// Convert a pixel offset within the day band to a snapped minutes-since-midnight.
export function offsetToMinutes(offsetPx: number): number {
  const raw = CALENDAR.dayStartHour * 60 + (offsetPx / CALENDAR.pxPerHour) * 60
  return snapMinutes(raw)
}

export interface LaneItem<T> {
  item: T
  lane: number
  laneCount: number
}

// Side-by-side layout for overlapping blocks within a single column. Items are
// grouped into overlap clusters; within a cluster each gets the first free lane,
// and every item in the cluster shares the cluster's lane count (so widths line
// up). Half-open overlap: back-to-back blocks don't share a cluster.
export function computeLanes<T>(
  items: T[],
  startOf: (item: T) => number,
  endOf: (item: T) => number
): LaneItem<T>[] {
  const sorted = [...items].sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b))
  const result: LaneItem<T>[] = []

  let cluster: LaneItem<T>[] = []
  let clusterEnd = -Infinity
  const laneEnds: number[] = [] // last end per lane in the current cluster

  const flush = () => {
    const laneCount = laneEnds.length
    for (const entry of cluster) entry.laneCount = laneCount
    cluster = []
    laneEnds.length = 0
    clusterEnd = -Infinity
  }

  for (const item of sorted) {
    const start = startOf(item)
    const end = endOf(item)
    if (start >= clusterEnd && cluster.length > 0) flush()

    // First lane whose last block has ended (<= start).
    let lane = laneEnds.findIndex(laneEnd => laneEnd <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    const entry: LaneItem<T> = { item, lane, laneCount: 1 }
    cluster.push(entry)
    result.push(entry)
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length > 0) flush()

  return result
}

// ── Range helpers (fetch windows) ────────────────────────────────────────────

// The [from, to) UTC instants (ISO) for the local day containing `anchor`.
export function dayRange(anchor: DateTime): { from: string, to: string } {
  const start = anchor.startOf('day')
  return { from: start.toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! }
}

// The [from, to) UTC instants for the local ISO week (Mon–Sun) containing `anchor`.
export function weekRange(anchor: DateTime): { from: string, to: string } {
  const start = anchor.startOf('week')
  return { from: start.toUTC().toISO()!, to: start.plus({ weeks: 1 }).toUTC().toISO()! }
}

// The seven local day-start DateTimes (Mon–Sun) of the week containing `anchor`.
export function weekDays(anchor: DateTime): DateTime[] {
  const start = anchor.startOf('week')
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }))
}

// A local 'yyyy-MM-ddTHH:mm' wall-clock stamp — the shape `<input
// type="datetime-local">`, dtStart and the reschedule API all use. Built by
// concatenation to avoid luxon's escaped-literal 'T' in the format token.
export function localDateTimeStamp(dt: DateTime): string {
  return `${dt.toFormat('yyyy-MM-dd')}T${dt.toFormat('HH:mm')}`
}

export function toLocalDateTimeInput(iso: string, timezone: string): string {
  return localDateTimeStamp(DateTime.fromISO(iso, { zone: timezone }))
}

export function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000)
}
