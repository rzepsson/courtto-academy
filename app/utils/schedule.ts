import { DateTime } from 'luxon'
import type { ScheduleSessionDto, LessonSessionDto, LessonSeriesDto, StudentSessionView } from '~~/server/database/types'
import { LESSON_TYPES } from '~~/shared/schedule'
import { scheduleSeriesSchema, scheduleSeriesMetadataPatchSchema, type ScheduleErrorCode } from '~~/shared/schedule-schema'

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

// The edit form binds this — the metadata subset the server accepts on PATCH
// (title/colour/capacity/enrolment policy; structural fields aren't editable).
export function scheduleMetadataFormSchema(t: (key: string) => string) {
  return scheduleSeriesMetadataPatchSchema(code => t(SCHEDULE_ERROR_KEYS[code]))
}

export function lessonTypeOptions(t: (key: string) => string): { value: string, label: string }[] {
  return LESSON_TYPES.map(value => ({ value, label: t(`schedule.types.${value}`) }))
}

// ── Recurrence (pure) ────────────────────────────────────────────────────────

// iCalendar weekday tokens, Monday-first (matches the week grid + start weekday).
export const SCHEDULE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof SCHEDULE_WEEKDAYS)[number]

export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly'

// Compile the compact recurrence controls into a supported RRULE (or null for a
// one-off). Weekly with no explicit day falls back to the start's weekday, so the
// series repeats on its own day. Shared by the create form and the edit panel.
export function buildRRule(freq: RecurrenceFreq, byday: string[], startWeekday: string): string | null {
  switch (freq) {
    case 'daily': return 'FREQ=DAILY'
    case 'monthly': return 'FREQ=MONTHLY'
    case 'weekly': {
      const days = byday.length ? byday : [startWeekday]
      return `FREQ=WEEKLY;BYDAY=${days.join(',')}`
    }
    default: return null
  }
}

// The inverse: derive the compact controls from a stored RRULE, so the edit panel
// opens showing the series' current recurrence. Unknown/unsupported rules degrade
// to a one-off ('none').
export function parseRecurrence(rrule: string | null): { freq: RecurrenceFreq, byday: string[] } {
  if (!rrule) return { freq: 'none', byday: [] }
  const upper = rrule.toUpperCase()
  if (/\bFREQ=DAILY\b/.test(upper)) return { freq: 'daily', byday: [] }
  if (/\bFREQ=MONTHLY\b/.test(upper)) return { freq: 'monthly', byday: [] }
  if (/\bFREQ=WEEKLY\b/.test(upper)) {
    const match = upper.match(/BYDAY=([A-Z,]+)/)
    const byday = match ? match[1]!.split(',').filter((d): d is Weekday => (SCHEDULE_WEEKDAYS as readonly string[]).includes(d)) : []
    return { freq: 'weekly', byday }
  }
  return { freq: 'none', byday: [] }
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

// The calendar's three layouts: day/week are the resource grid, agenda is the
// grouped list. Day fetches a day window; week and agenda fetch the week window.
export type ScheduleView = 'day' | 'week' | 'agenda'

// ── Filters (pure) ───────────────────────────────────────────────────────────

// The calendar's client-side filter model. Each list is "empty = no constraint"
// (match all); a non-empty list keeps only sessions matching one of its values.
// `coachMemberIds` may include NO_COACH_VALUE to match unassigned sessions.
export interface ScheduleFilterState {
  coachMemberIds: string[]
  courtIds: string[]
  sports: string[]
  types: string[]
  status: 'all' | 'active' | 'cancelled'
}

export const EMPTY_SCHEDULE_FILTERS: ScheduleFilterState = {
  coachMemberIds: [],
  courtIds: [],
  sports: [],
  types: [],
  status: 'all'
}

// True when any constraint is set — drives the "clear" affordance.
export function isScheduleFilterActive(f: ScheduleFilterState): boolean {
  return f.coachMemberIds.length > 0
    || f.courtIds.length > 0
    || f.sports.length > 0
    || f.types.length > 0
    || f.status !== 'all'
}

export function sessionMatchesFilters(session: ScheduleSessionView, f: ScheduleFilterState): boolean {
  if (f.coachMemberIds.length) {
    const key = session.coachMemberId ?? NO_COACH_VALUE
    if (!f.coachMemberIds.includes(key)) return false
  }
  if (f.courtIds.length && (session.courtId === null || !f.courtIds.includes(session.courtId))) return false
  if (f.sports.length && !f.sports.includes(session.sport)) return false
  if (f.types.length && !f.types.includes(session.type)) return false
  if (f.status === 'active' && session.status === 'cancelled') return false
  if (f.status === 'cancelled' && session.status !== 'cancelled') return false
  return true
}

// ── Grid / time math (pure) ──────────────────────────────────────────────────

// The DEFAULT visible time band on the day/week grid, and the pixel scale. Kept
// generous enough for typical lessons; the grid auto-expands past it (see
// `computeBand`) when a lesson starts earlier or ends later, so nothing is ever
// clipped off-grid.
export const CALENDAR = {
  dayStartHour: 7,
  dayEndHour: 23,
  pxPerHour: 64,
  snapMinutes: 15
} as const

// The hour range a grid renders. Defaults to the CALENDAR band; widened per-view
// to fit outlier lessons. `startHour`/`endHour` are whole hours in [0, 24].
export interface CalendarBand {
  startHour: number
  endHour: number
}

export const DEFAULT_BAND: CalendarBand = { startHour: CALENDAR.dayStartHour, endHour: CALENDAR.dayEndHour }

// Minimum block height so a very short (or clamped-to-edge) lesson stays clickable.
const MIN_BLOCK_PX = 16

export function gridMinutes(band: CalendarBand = DEFAULT_BAND): number {
  return (band.endHour - band.startHour) * 60
}

export function gridHeightPx(band: CalendarBand = DEFAULT_BAND): number {
  return (band.endHour - band.startHour) * CALENDAR.pxPerHour
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

// A block's top/height in pixels within the given band. Clamped so a block that
// starts before / ends after the visible band — or exactly at the band end —
// still renders a visible, clickable sliver at the edge rather than off-grid.
export function blockGeometry(startMin: number, endMin: number, band: CalendarBand = DEFAULT_BAND): { top: number, height: number } {
  const bandStart = band.startHour * 60
  const bandEnd = band.endHour * 60
  const maxTop = gridHeightPx(band) - MIN_BLOCK_PX
  const top = Math.min(Math.max((Math.max(startMin, bandStart) - bandStart) / 60 * CALENDAR.pxPerHour, 0), maxTop)
  const bottom = (Math.min(endMin, bandEnd) - bandStart) / 60 * CALENDAR.pxPerHour
  return { top, height: Math.max(bottom - top, MIN_BLOCK_PX) }
}

// Snap a minute value to the grid (e.g. 15-min increments).
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / CALENDAR.snapMinutes) * CALENDAR.snapMinutes
}

// Every 'HH:mm' on the grid increment across a day — the options for the
// time picker in the date+time field. 96 entries at 15-min spacing.
export function quarterHourTimes(): string[] {
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += CALENDAR.snapMinutes) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
}

// Convert a pixel offset within the band to a snapped minutes-since-midnight.
export function offsetToMinutes(offsetPx: number, band: CalendarBand = DEFAULT_BAND): number {
  const raw = band.startHour * 60 + (offsetPx / CALENDAR.pxPerHour) * 60
  return snapMinutes(raw)
}

// The hour band a set of sessions needs: the DEFAULT band, widened to fit any
// lesson that starts before it or ends after it (clamped to a full day). So the
// grid shows 07–23 normally, but a 06:00 or 22:30–00:00 lesson expands it rather
// than being clipped. Sessions are read in the given zone.
export function computeBand(sessions: ScheduleSessionView[], timezone: string): CalendarBand {
  let startHour = DEFAULT_BAND.startHour
  let endHour = DEFAULT_BAND.endHour
  for (const s of sessions) {
    const startMin = localMinutes(s.startsAt, timezone)
    const endMin = Math.min(startMin + durationMinutes(s.startsAt, s.endsAt), 24 * 60)
    startHour = Math.min(startHour, Math.floor(startMin / 60))
    endHour = Math.max(endHour, Math.ceil(endMin / 60))
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) }
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

// ── Agenda grouping (pure) ───────────────────────────────────────────────────

export interface AgendaDay {
  key: string // local 'yyyy-MM-dd'
  sessions: ScheduleSessionView[]
}

// Group sessions into ascending local days, each day's sessions sorted by start.
// Days with no sessions are omitted — the agenda lists only what's scheduled.
export function groupSessionsByDay(sessions: ScheduleSessionView[], timezone: string): AgendaDay[] {
  const byDay = new Map<string, ScheduleSessionView[]>()
  for (const s of sessions) {
    const key = localDayKey(s.startsAt, timezone)
    ;(byDay.get(key) ?? byDay.set(key, []).get(key)!).push(s)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, list]) => ({
      key,
      sessions: list.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))
    }))
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
