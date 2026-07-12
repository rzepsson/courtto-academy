// Academy scheduling domain: lesson constants/guards plus the generic,
// DST-correct time & recurrence helpers used to materialize a series into
// concrete occurrences. BOTH ends rely on this — the server materializes and
// validates against these rules, the client previews the same occurrences in
// the builder — so the two can never disagree.
//
// The product-neutral occupancy primitive (reservation) lives in
// shared/reservation.ts (facility-core). This file is the ACADEMY layer on top.
//
// Keep free of Nuxt/Node imports (like shared/courts.ts) — it must load in any
// context. `rrule` and `luxon` are pure JS and safe to bundle client-side.

import { RRule } from 'rrule'
import { DateTime } from 'luxon'
import { COURT_COLOR_PRESETS } from './courts'

// The nature of a lesson. Deliberately orthogonal to recurrence (one-off vs
// recurring is the presence/absence of an rrule, never a type) and to
// coach-presence — `open` is a court block members book themselves, no coach.
export const LESSON_TYPES = ['group', 'individual', 'open'] as const
export type LessonType = (typeof LESSON_TYPES)[number]

// Lifecycle of a whole series.
export const SERIES_STATUSES = ['active', 'ended', 'cancelled'] as const
export type SeriesStatus = (typeof SERIES_STATUSES)[number]

// Lifecycle of a single materialized occurrence.
export const SESSION_STATUSES = ['scheduled', 'cancelled', 'completed', 'rescheduled'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

// How a divergent occurrence differs from the pure RRULE expansion — the
// iCalendar EXDATE / RECURRENCE-ID model, recorded so re-materialization and
// "edit the whole series" never clobber a manually changed occurrence.
// `skipped` records an occurrence the horizon extension could not materialize
// (court/coach conflict) — a durable, visible gap rather than a silent loss.
export const EXCEPTION_ACTIONS = ['cancelled', 'rescheduled', 'modified', 'skipped'] as const
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number]

export const ENROLLMENT_STATUSES = ['enrolled', 'waitlisted', 'cancelled'] as const
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

export const ATTENDANCE_STATUSES = ['present', 'absent', 'excused', 'late'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

// Who can see a series/session. Seam for finer visibility later (per-group etc.).
export const LESSON_VISIBILITY = ['members', 'private'] as const
export type LessonVisibility = (typeof LESSON_VISIBILITY)[number]

// Reuse the court palette so a lesson block sits visually alongside its court.
export const LESSON_COLOR_PRESETS = COURT_COLOR_PRESETS
export const DEFAULT_LESSON_COLOR = '#2f6db5'

// Max stored length / bound per field — enforced on both sides.
export const SCHEDULE_LIMITS = {
  title: 120,
  notes: 500,
  level: 60,
  ageGroup: 60,
  id: 64,
  rrule: 512,
  minDurationMin: 5,
  maxDurationMin: 24 * 60,
  maxCapacity: 1000,
  // Safety cap on how many occurrences a single expansion may yield, so a
  // pathological rule can never fan out unbounded.
  maxOccurrences: 500
} as const

// How far ahead a recurring series is materialized into concrete sessions on
// creation — a rolling horizon that bounds row growth. A later job (Phase 3)
// extends it as the horizon approaches; a series with a COUNT/UNTIL shorter than
// this is fully materialized at once. A single (no-rrule) lesson ignores it.
export const MATERIALIZATION_HORIZON_DAYS = 120

export function isLessonType(value: string): value is LessonType {
  return (LESSON_TYPES as readonly string[]).includes(value)
}
export function isSeriesStatus(value: string): value is SeriesStatus {
  return (SERIES_STATUSES as readonly string[]).includes(value)
}
export function isSessionStatus(value: string): value is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value)
}
export function isEnrollmentStatus(value: string): value is EnrollmentStatus {
  return (ENROLLMENT_STATUSES as readonly string[]).includes(value)
}
export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value)
}
export function isLessonVisibility(value: string): value is LessonVisibility {
  return (LESSON_VISIBILITY as readonly string[]).includes(value)
}

// Cross-field capacity check. Null/absent on either side is permissive (no
// bound). Used by the service on the effective (possibly stored) values, which
// the static schema can't see on a partial update.
export function isCapacityRangeValid(
  min: number | null | undefined,
  max: number | null | undefined
): boolean {
  if (min == null || max == null) return true
  return min <= max
}

// ── Time & recurrence (generic, DST-correct) ─────────────────────────────────
//
// A series stores its start as WALL-CLOCK local time ('YYYY-MM-DDTHH:mm') plus
// an IANA timezone; occurrences are resolved to absolute UTC instants at
// materialization. Crucially the resolution happens PER occurrence in the zone,
// so "every Monday 17:00" stays 17:00 local across a DST transition instead of
// drifting by an hour (the trap plain UTC-plus-7-days falls into).

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

interface LocalParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

function parseLocalParts(value: string): LocalParts | null {
  const match = LOCAL_DATETIME_RE.exec(value)
  if (!match) return null
  const parts: LocalParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  }
  if (parts.month < 1 || parts.month > 12) return null
  if (parts.day < 1 || parts.day > 31) return null
  if (parts.hour > 23 || parts.minute > 59) return null
  // Reject well-formed but impossible dates (e.g. 2026-02-30): a real date
  // survives a UTC round-trip unchanged. Enforced here — not only in
  // isValidLocalDateTime — because localDateTimeToInstant / expandOccurrences
  // rely on parseLocalParts to refuse a bad value rather than silently produce a
  // NaN instant or roll the recurrence anchor over into the next month.
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute))
  if (
    probe.getUTCFullYear() !== parts.year
    || probe.getUTCMonth() !== parts.month - 1
    || probe.getUTCDate() !== parts.day
  ) {
    return null
  }
  return parts
}

// A well-formed 'YYYY-MM-DDTHH:mm' that names a real calendar date.
export function isValidLocalDateTime(value: string): boolean {
  return parseLocalParts(value) !== null
}

function partsToInstant(parts: LocalParts, timezone: string): Date {
  return DateTime.fromObject(
    { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute },
    { zone: timezone }
  ).toJSDate()
}

function instantToParts(instant: Date, timezone: string): LocalParts {
  const dt = DateTime.fromJSDate(instant, { zone: timezone })
  return { year: dt.year, month: dt.month, day: dt.day, hour: dt.hour, minute: dt.minute }
}

// The wall-clock of an instant in a zone, expressed as a "floating" UTC Date
// (its UTC fields carry the local numbers) — the clock rrule operates in.
function instantToFloating(instant: Date, timezone: string): Date {
  const dt = DateTime.fromJSDate(instant, { zone: timezone })
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second))
}

// Resolve a single wall-clock local time in a zone to its absolute UTC instant.
export function localDateTimeToInstant(value: string, timezone: string): Date {
  const parts = parseLocalParts(value)
  if (!parts) throw new Error(`Invalid local date-time: ${value}`)
  return partsToInstant(parts, timezone)
}

function stripRRulePrefix(rrule: string): string {
  return rrule.replace(/^RRULE:/i, '')
}

// Whether a string is a parseable RFC 5545 recurrence rule with a frequency.
// Defense-in-depth behind the builder (which only emits valid rules).
export function isValidRRule(value: string): boolean {
  try {
    const options = RRule.parseString(stripRRulePrefix(value))
    return options.freq !== undefined && options.freq !== null
  } catch {
    return false
  }
}

// A recurrence we actually support for lessons: DAILY or coarser (WEEKLY,
// MONTHLY, YEARLY). Sub-daily frequencies (HOURLY/MINUTELY/SECONDLY) are
// rejected — they'd let occurrences of one series overlap each other on the same
// court and fan out to thousands of rows. rrule's Frequency enum is ordered
// YEARLY(0) … DAILY(3) … SECONDLY(6), so "DAILY or coarser" is `freq <= DAILY`.
export function isSupportedRecurrence(value: string): boolean {
  try {
    const options = RRule.parseString(stripRRulePrefix(value))
    return options.freq !== undefined && options.freq !== null && options.freq <= RRule.DAILY
  } catch {
    return false
  }
}

export interface Occurrence {
  // The original scheduled start (the recurrence anchor for this instance) — the
  // stable key an exception/override is matched against. Note: for a wall-clock
  // time that doesn't exist on a spring-forward day, luxon shifts it into the
  // post-transition offset, so this resolved value is the shifted instant; the
  // Phase-3 exception matcher must key off this same resolved value (never a raw
  // pre-resolution wall-clock slot) so materialization and matching agree.
  occurrenceStart: Date
  startsAt: Date
  endsAt: Date
}

// Expand a (possibly recurring) definition into concrete UTC-instant occurrences
// intersecting the [from, to) window. `rrule` absent/null → a single occurrence.
//
// rrule computes in "floating" wall-clock (we feed a UTC date whose fields ARE
// the local numbers), then each result is re-localized in `timezone` via luxon,
// which applies the correct offset for that specific date — the DST-safe path.
export function expandOccurrences(input: {
  dtStart: string
  timezone: string
  durationMin: number
  rrule?: string | null
  from: Date
  to: Date
  max?: number
}): Occurrence[] {
  const start = parseLocalParts(input.dtStart)
  if (!start) throw new Error(`Invalid dtStart: ${input.dtStart}`)

  const durationMs = input.durationMin * MS_PER_MINUTE
  const max = input.max ?? SCHEDULE_LIMITS.maxOccurrences
  const fromMs = input.from.getTime()
  const toMs = input.to.getTime()

  const build = (parts: LocalParts): Occurrence => {
    const startsAt = partsToInstant(parts, input.timezone)
    return { occurrenceStart: startsAt, startsAt, endsAt: new Date(startsAt.getTime() + durationMs) }
  }
  const inWindow = (occ: Occurrence) => occ.startsAt.getTime() >= fromMs && occ.startsAt.getTime() < toMs

  if (!input.rrule) {
    const occ = build(start)
    return inWindow(occ) ? [occ] : []
  }

  const options = RRule.parseString(stripRRulePrefix(input.rrule))
  const dtstartFloating = new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute))
  // rrule parses an RFC 5545 UNTIL (…Z) as an absolute instant, but our rule
  // runs in floating wall-clock — comparing the two would cut occurrences off by
  // the zone's UTC offset. Re-express UNTIL in the same floating clock (its
  // wall-clock in the series zone) so the boundary is applied consistently.
  if (options.until) {
    options.until = instantToFloating(options.until, input.timezone)
  }
  const rule = new RRule({ ...options, dtstart: dtstartFloating })

  // Widen the floating query window generously (2 days each side) to absorb the
  // UTC↔local offset, then filter precisely by the resolved instant. Two days
  // dwarfs any single-zone offset + DST shift; lesson cadences are daily/weekly,
  // never sub-daily, so no occurrence can hide in the residual margin.
  const fromParts = instantToParts(input.from, input.timezone)
  const toParts = instantToParts(input.to, input.timezone)
  const marginMs = 2 * MS_PER_DAY
  const afterFloat = new Date(Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day) - marginMs)
  const beforeFloat = new Date(Date.UTC(toParts.year, toParts.month - 1, toParts.day) + marginMs)

  const occurrences: Occurrence[] = []
  for (const floating of rule.between(afterFloat, beforeFloat, true)) {
    const occ = build({
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes()
    })
    if (inWindow(occ)) {
      occurrences.push(occ)
      if (occurrences.length >= max) break
    }
  }
  return occurrences
}
