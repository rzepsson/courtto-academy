import type { OrgRole } from '../../shared/permissions'

export type Organization = typeof import('./schema').organization.$inferSelect

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  logo: string | null
}

export interface Membership {
  id: string
  role: OrgRole
  createdAt: Date
  organization: OrganizationSummary
}

export interface AppContext {
  memberships: Membership[]
  activeOrganizationId: string | null
}

export interface OrganizationMember {
  id: string
  role: OrgRole
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  expiresAt: Date
}

export interface JoinCode {
  code: string
  enabled: boolean
  expiresAt: Date
}

export type OrgProfile = typeof import('./app-schema').orgProfile.$inferSelect

// The editable subset of the profile (everything except the org id and the
// managed timestamps). Both the PATCH body and the service `set` are typed
// against this so a new column is wired through in one place.
export type OrgProfileInput = Omit<OrgProfile, 'organizationId' | 'createdAt' | 'updatedAt'>

export type Court = typeof import('./app-schema').court.$inferSelect

// The writable subset of a court — everything an admin sets in the builder.
// Both the normalized PATCH/POST body and the service `set` are typed against
// this, so a new column is wired through in one place. Managed fields (id,
// organizationId, sortOrder, archivedAt, audit/timestamps) are excluded.
export interface CourtWritable {
  name: string
  sport: string
  surface: string | null
  environment: string
  surfaceColor: string
  lineColor: string
  zone: string | null
  bookable: boolean
  notes: string | null
}

// The client-facing court shape — the roster and builder bind against this. Org
// id and audit columns (createdBy) are never sent to the client.
export interface CourtDto extends CourtWritable {
  id: string
  sortOrder: number
  archivedAt: Date | null
  createdAt: Date
}

export type NotificationRow = typeof import('./app-schema').notification.$inferSelect

// The client-facing shape of a notification. `data` is the interpolation params
// for the localized title/body; the server never sends rendered text.
export interface NotificationDto {
  id: string
  type: string
  organizationId: string | null
  data: Record<string, string | number | null> | null
  link: string | null
  read: boolean
  dismissible: boolean
  createdAt: Date
}

export interface NotificationFeed {
  notifications: NotificationDto[]
  unreadCount: number
}

export interface JoinCodeTarget {
  organizationId: string
  organization: OrganizationSummary
}

export type InvitationLandingStatus = 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired'

export interface InvitationLanding {
  id: string
  maskedEmail: string
  role: OrgRole
  status: InvitationLandingStatus
  expiresAt: Date
  inviterName: string
  organization: OrganizationSummary
}

// ─── Schedule ──────────────────────────────────────────────────────────────
// Row types (full table shape) + client-facing DTOs. Like CourtDto, the DTOs
// drop organizationId and audit columns and keep enum-ish fields as plain
// strings (validated by the shared schema / service). Client dates arrive
// serialized; the client binds against a *View shape with string dates.

export type Reservation = typeof import('./app-schema').reservation.$inferSelect
export type LessonSeries = typeof import('./app-schema').lessonSeries.$inferSelect
export type LessonSeriesRule = typeof import('./app-schema').lessonSeriesRule.$inferSelect
export type LessonSession = typeof import('./app-schema').lessonSession.$inferSelect
export type LessonException = typeof import('./app-schema').lessonException.$inferSelect
export type Enrollment = typeof import('./app-schema').enrollment.$inferSelect
export type Attendance = typeof import('./app-schema').attendance.$inferSelect

// CORE — the occupancy primitive. `bookedBy*` seams stay server-side.
export interface ReservationDto {
  id: string
  courtId: string
  startsAt: Date
  endsAt: Date
  status: string
  kind: string
  title: string | null
  note: string | null
  createdAt: Date
}

export interface LessonSeriesDto {
  id: string
  type: string
  sport: string
  title: string
  color: string
  level: string | null
  ageGroup: string | null
  notes: string | null
  assistantCoachMemberId: string | null
  timezone: string
  capacityMin: number | null
  capacityMax: number | null
  enrollmentOpen: boolean
  visibility: string
  status: string
  createdAt: Date
}

export interface LessonSessionDto {
  id: string
  seriesId: string
  reservationId: string
  occurrenceStart: Date
  startsAt: Date
  endsAt: Date
  coachMemberId: string | null
  courtId: string | null
  capacityMax: number | null
  status: string
  cancelReason: string | null
  overridden: boolean
  notes: string | null
}

export interface EnrollmentDto {
  id: string
  studentMemberId: string
  seriesId: string | null
  sessionId: string | null
  status: string
  waitlistPos: number | null
  createdAt: Date
}

export interface AttendanceDto {
  id: string
  sessionId: string
  studentMemberId: string
  status: string
  markedBy: string | null
  markedAt: Date
}

// A materialized occurrence flattened with the series display fields and its
// reservation status — the calendar/roster read shape (avoids an N+1 to the
// series). `seriesTitle`/`type`/`sport`/`color` come from the parent series.
export interface ScheduleSessionDto {
  id: string
  seriesId: string
  reservationId: string
  startsAt: Date
  endsAt: Date
  occurrenceStart: Date
  status: string
  overridden: boolean
  coachMemberId: string | null
  courtId: string | null
  capacityMax: number | null
  notes: string | null
  reservationStatus: string
  seriesTitle: string
  type: string
  sport: string
  color: string
}

// One recurrence rule of a series (a VEVENT-equivalent). The client-facing shape;
// drops organizationId/audit columns like the other DTOs.
export interface LessonSeriesRuleDto {
  id: string
  rrule: string | null
  dtStart: string
  durationMin: number
  timezone: string
  courtId: string | null
  coachMemberId: string | null
  materializedUntil: Date | null
}

// A series with its recurrence rules + materialized sessions — the create result
// and detail view. `rules` carries the 1..N day/time patterns the group meets on.
export interface LessonDetail {
  series: LessonSeriesDto
  rules: LessonSeriesRuleDto[]
  sessions: LessonSessionDto[]
}

// Outcome of extending a recurring series' materialization horizon: how many
// occurrences were newly created vs skipped (court/coach conflict), and the new
// horizon. materializedUntil is null only for a non-recurring series.
export interface ExtendResult {
  created: number
  skipped: number
  materializedUntil: Date | null
}

// Outcome of one materialization sweep (the scheduled job that rolls every active
// recurring series' horizon forward). `ok` ran; `busy` means another sweep on this
// instance was still running and this tick was skipped. `capped` is true when more
// series were due than the per-run cap (harmless — the 120-day horizon means being
// one run behind never starves a series; the rest are picked up next run).
export interface MaterializationSweepResult {
  status: 'ok' | 'busy'
  processed: number
  created: number
  skipped: number
  failed: number
  capped: boolean
}

// An enrolment with the student's display fields — the staff-facing list shape.
export interface EnrollmentView {
  id: string
  studentMemberId: string
  studentName: string
  studentEmail: string
  seriesId: string | null
  sessionId: string | null
  status: string
  waitlistPos: number | null
  createdAt: Date
}

// The series-level capacity context the staff enrolment panel needs alongside the
// list: the seat cap (null = unlimited) and whether enrolment is open (closed
// locks the group — staff adds are rejected too, matching the enrol service).
export interface SeriesEnrollmentSummary {
  capacityMax: number | null
  enrollmentOpen: boolean
}

// One expected attendee of a session (an enrolled student) with their marked
// attendance, if any. `source` distinguishes a series enrolment from a per-
// session drop-in. The attendance sheet a coach/admin fills in.
export interface RosterEntry {
  studentMemberId: string
  studentName: string
  studentEmail: string
  source: 'series' | 'session'
  attendanceStatus: string | null
}

// A session as a student sees it on their own schedule — the calendar shape plus
// the student's own enrolment status for it (enrolled | waitlisted).
export interface StudentSessionView extends ScheduleSessionDto {
  enrollmentStatus: string
}
