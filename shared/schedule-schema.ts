// The single, canonical definition of what a valid lesson series/session input
// is. One Zod schema drives BOTH ends: the builder binds it to `UForm :schema`
// for live validation, and the server parses the POST/PATCH body against the
// same rules (see server/utils/services/schedule.ts). Mirrors courts-schema.ts
// and org-profile-schema.ts. Keep free of Nuxt/Node imports.
//
// Context-dependent rules stay in the service, not this static schema: the sport
// must be one the facility offers (orgProfile.sports); the coach/court ids must
// resolve to real members/courts of this org; the capacity range and time-window
// checks that need the effective (possibly stored) values on a partial update.
// The schema owns everything context-free.

import { z } from 'zod'
import { isSport } from './org-profile'
import { isValidTimezone } from './regional'
import { isHexColor } from './courts'
import {
  SCHEDULE_LIMITS,
  isLessonType,
  isLessonVisibility,
  isSupportedRecurrence,
  isValidLocalDateTime
} from './schedule'

// Stable machine codes the schema raises; wording comes from a resolver (client
// → localized i18n keys, server → identity/raw codes that are never user-facing).
export const SCHEDULE_ERROR_CODES = [
  'required', 'tooLong', 'type', 'sport', 'color', 'timezone', 'rrule', 'dtStart', 'duration', 'capacity', 'visibility'
] as const
export type ScheduleErrorCode = (typeof SCHEDULE_ERROR_CODES)[number]

export type ScheduleMessageResolver = (code: ScheduleErrorCode) => string

function requiredText(max: number, msg: ScheduleMessageResolver) {
  return z.string().trim().min(1, msg('required')).max(max, msg('tooLong'))
}

// Optional free text that collapses whitespace-only / empty input to null.
function optionalText(max: number, msg: ScheduleMessageResolver) {
  return z
    .string()
    .trim()
    .max(max, msg('tooLong'))
    .transform(value => (value === '' ? null : value))
    .nullable()
    .optional()
}

function optionalRRule(msg: ScheduleMessageResolver) {
  return z
    .string()
    .trim()
    .max(SCHEDULE_LIMITS.rrule, msg('tooLong'))
    // Parseable AND a supported (daily-or-coarser) frequency — sub-daily rules
    // are rejected here so form and API agree.
    .refine(value => value === '' || isSupportedRecurrence(value), msg('rrule'))
    .transform(value => (value === '' ? null : value))
    .nullable()
    .optional()
}

function optionalCapacity(msg: ScheduleMessageResolver) {
  return z
    .number()
    .int()
    .min(0, msg('capacity'))
    .max(SCHEDULE_LIMITS.maxCapacity, msg('capacity'))
    .nullable()
    .optional()
}

// The complete field-by-field definition, parameterized by the message resolver.
// Only the operational essentials are required; the service fills defaults on
// create (color/visibility/enrollmentOpen) — NOT via Zod `.default()`, which
// `.partial()` would re-inject and silently reset an untouched field on PATCH.
export function scheduleSeriesSchema(msg: ScheduleMessageResolver) {
  return z.object({
    type: z.string().refine(isLessonType, msg('type')),
    // The client only offers sports the facility declared; the refine is the
    // server-side guard. The facility-offer check lives in the service.
    sport: z.string().refine(isSport, msg('sport')),
    title: requiredText(SCHEDULE_LIMITS.title, msg),
    color: z.string().trim().refine(isHexColor, msg('color')).optional(),
    level: optionalText(SCHEDULE_LIMITS.level, msg),
    ageGroup: optionalText(SCHEDULE_LIMITS.ageGroup, msg),
    notes: optionalText(SCHEDULE_LIMITS.notes, msg),

    // Ids are validated for shape only; existence/role/tenant checks are the
    // service's job (it looks them up scoped by organizationId). Field names
    // mirror the stored column / DTO 1:1 (defaultCourtId), so the form and API
    // never drift. A court is REQUIRED — every occurrence reserves one; the coach
    // is optional (an open-court block has none). `assistantCoachMemberId` is a
    // DB-only seam (like reservation.bookedBy*): not accepted here until it's
    // fully wired (per-session materialization + conflict-checking).
    coachMemberId: optionalText(SCHEDULE_LIMITS.id, msg),
    defaultCourtId: requiredText(SCHEDULE_LIMITS.id, msg),

    // Wall-clock local start + IANA zone; the service resolves occurrences to
    // UTC instants. dtStart is 'YYYY-MM-DDTHH:mm'. `timezone` is optional — the
    // service snapshots orgProfile.timezone when it's absent (the normal case);
    // it's accepted here only for the rare per-series override.
    timezone: z.string().trim().max(64, msg('tooLong')).refine(isValidTimezone, msg('timezone')).optional(),
    dtStart: z.string().trim().refine(isValidLocalDateTime, msg('dtStart')),
    durationMin: z
      .number()
      .int()
      .min(SCHEDULE_LIMITS.minDurationMin, msg('duration'))
      .max(SCHEDULE_LIMITS.maxDurationMin, msg('duration')),
    // Null/absent → a one-off (single) occurrence; present → a recurring series.
    rrule: optionalRRule(msg),

    capacityMin: optionalCapacity(msg),
    capacityMax: optionalCapacity(msg),
    enrollmentOpen: z.boolean().optional(),
    visibility: z.string().refine(isLessonVisibility, msg('visibility')).optional()
  })
}

// The normalized, stored shape of a series' writable values (post-transform).
export type ScheduleSeriesValues = z.infer<ReturnType<typeof scheduleSeriesSchema>>

// One recurrence RULE = one VEVENT: when (dtStart + rrule + duration) and where/
// who-teaches (court + coach). A series carries 1..N of these, so one group can
// meet at several day/time slots. Court is required (every occurrence reserves
// one); the coach is optional. Field names mirror the lessonSeriesRule columns.
export function scheduleRuleSchema(msg: ScheduleMessageResolver) {
  return z.object({
    rrule: optionalRRule(msg),
    dtStart: z.string().trim().refine(isValidLocalDateTime, msg('dtStart')),
    durationMin: z
      .number()
      .int()
      .min(SCHEDULE_LIMITS.minDurationMin, msg('duration'))
      .max(SCHEDULE_LIMITS.maxDurationMin, msg('duration')),
    courtId: requiredText(SCHEDULE_LIMITS.id, msg),
    coachMemberId: optionalText(SCHEDULE_LIMITS.id, msg)
  })
}

export type ScheduleRuleValues = z.infer<ReturnType<typeof scheduleRuleSchema>>

// Create: the group's context-free fields + its recurrence RULES (1..N). The
// server normalizes a legacy flat `{ dtStart, durationMin, rrule, defaultCourtId,
// coachMemberId }` body into a single rule before parsing, so old callers/forms
// keep working. The service fills group defaults + validates context rules.
export function scheduleSeriesCreateSchema(msg: ScheduleMessageResolver) {
  return z.object({
    type: z.string().refine(isLessonType, msg('type')),
    sport: z.string().refine(isSport, msg('sport')),
    title: requiredText(SCHEDULE_LIMITS.title, msg),
    color: z.string().trim().refine(isHexColor, msg('color')).optional(),
    level: optionalText(SCHEDULE_LIMITS.level, msg),
    ageGroup: optionalText(SCHEDULE_LIMITS.ageGroup, msg),
    notes: optionalText(SCHEDULE_LIMITS.notes, msg),
    timezone: z.string().trim().max(64, msg('tooLong')).refine(isValidTimezone, msg('timezone')).optional(),
    capacityMin: optionalCapacity(msg),
    capacityMax: optionalCapacity(msg),
    enrollmentOpen: z.boolean().optional(),
    visibility: z.string().refine(isLessonVisibility, msg('visibility')).optional(),
    rules: z.array(scheduleRuleSchema(msg)).min(1, msg('required')).max(SCHEDULE_LIMITS.maxRules, msg('tooLong'))
  })
}

// Update: partial, so only the keys present in the PATCH body are validated and
// applied. Since no field carries a Zod default, an absent key stays absent.
export function scheduleSeriesPatchSchema(msg: ScheduleMessageResolver) {
  return scheduleSeriesSchema(msg).partial()
}

// The series fields that can be edited WITHOUT re-materializing occurrences or
// touching reservations — presentation, capacity and enrolment policy. Changing
// structural fields (dtStart/durationMin/rrule/defaultCourtId/coach/type/sport/
// timezone) needs occurrence propagation and lands in a later phase, so the
// metadata PATCH deliberately can't express them.
export const SERIES_METADATA_FIELDS = [
  'title', 'color', 'level', 'ageGroup', 'notes', 'capacityMin', 'capacityMax', 'visibility', 'enrollmentOpen'
] as const
export type SeriesMetadataField = (typeof SERIES_METADATA_FIELDS)[number]

export function scheduleSeriesMetadataPatchSchema(msg: ScheduleMessageResolver) {
  const mask = Object.fromEntries(SERIES_METADATA_FIELDS.map(field => [field, true]))
  return scheduleSeriesSchema(msg).pick(mask as Record<SeriesMetadataField, true>).partial()
}

// A non-empty id that can be omitted (absent = keep) but not cleared.
function optionalId(msg: ScheduleMessageResolver) {
  return z.string().trim().min(1, msg('required')).max(SCHEDULE_LIMITS.id, msg('tooLong')).optional()
}

// Editing a SINGLE occurrence (reschedule / override / substitute). All fields
// optional — absent means "keep". A moved time is a new wall-clock local start
// ('YYYY-MM-DDTHH:mm') resolved in the series timezone by the service. `courtId`
// can be changed but not cleared (an occurrence always reserves a court);
// `coachMemberId` is nullable (clearing it makes the occurrence coach-less).
export function sessionUpdateSchema(msg: ScheduleMessageResolver) {
  return z.object({
    startsAt: z.string().trim().refine(isValidLocalDateTime, msg('dtStart')).optional(),
    durationMin: z
      .number()
      .int()
      .min(SCHEDULE_LIMITS.minDurationMin, msg('duration'))
      .max(SCHEDULE_LIMITS.maxDurationMin, msg('duration'))
      .optional(),
    courtId: optionalId(msg),
    coachMemberId: optionalText(SCHEDULE_LIMITS.id, msg),
    capacityMax: optionalCapacity(msg),
    notes: optionalText(SCHEDULE_LIMITS.notes, msg)
  })
}
