import type { OrgRole } from '../../shared/permissions'
import type { MemberStatus } from '../../shared/member-profile'

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
  // Lifecycle status from the memberProfile sidecar (coalesced to 'active' when no
  // row exists). Drives access enforcement: a non-active membership is blocked at
  // the server guard and routed to /access-paused on the client.
  status: MemberStatus
  createdAt: Date
  organization: OrganizationSummary
}

export interface AppContext {
  memberships: Membership[]
  activeOrganizationId: string | null
}

// The flat member list behind `GET /api/school/members` — the schedule + court
// pickers' source. Carries the sidecar's `status` and `canCoach` so a picker can
// offer only members who are active and actually set up to coach.
export interface OrganizationMember {
  id: string
  role: OrgRole
  status: MemberStatus
  canCoach: boolean
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

// ─── Member profile (sidecar to Better Auth's `member`) ──────────────────────

export type MemberProfileRow = typeof import('./app-schema').memberProfile.$inferSelect

// The editable subset of a member's sidecar profile (everything except the id
// and managed timestamps). The PATCH body and the service `set` are typed against
// this, so a new sidecar column is wired through in one place.
export interface MemberProfileInput {
  status: MemberStatus
  canCoach: boolean
  // 'YYYY-MM-DD' calendar date (never an instant) — drives the derived minor check.
  dateOfBirth: string | null
  notes: string | null
  tags: string[]
}

export type MemberGuardianRow = typeof import('./app-schema').memberGuardian.$inferSelect

// The writable subset of a guardian record — both the request body and the service
// `set` are typed against this, so a new column is wired through in one place.
export interface MemberGuardianInput {
  name: string
  relationship: string
  phone: string | null
  email: string | null
  isPrimary: boolean
  notes: string | null
}

// The client-facing guardian shape: org id / member id / audit columns are never
// exposed (the caller already knows whose guardians it asked for).
export interface MemberGuardianDto extends MemberGuardianInput {
  id: string
  createdAt: Date
}

// A single member's full record for the detail cockpit — the directory row plus
// the staff-only `notes` (omitted from the list for leanness). Scoped read.
export interface MemberDetail {
  id: string
  role: OrgRole
  createdAt: Date
  status: MemberStatus
  canCoach: boolean
  dateOfBirth: string | null
  notes: string | null
  tags: string[]
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

// One row of the paginated member directory — the Better Auth membership fields
// enriched with the sidecar. `notes` is intentionally omitted (it's detail-view
// data: keeps the list payload lean and never broadcasts staff notes across the
// whole roster).
export interface MemberDirectoryRow {
  id: string
  role: OrgRole
  createdAt: Date
  status: MemberStatus
  canCoach: boolean
  tags: string[]
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

// The (all-optional) filter/sort/paginate inputs the directory accepts live in
// shared/ (pure input shape, Nuxt/Node-free, used by the request parser); re-
// exported here so server code importing directory types has one import site.
export type { MemberDirectoryQuery } from '../../shared/member-profile'

// A page of directory rows plus the total matching the filters (for pagination UI)
// and the resolved page/pageSize actually applied.
export interface MemberDirectoryResult {
  rows: MemberDirectoryRow[]
  total: number
  page: number
  pageSize: number
}

// ─── Academy people-analytics ────────────────────────────────────────────────

// One group (lesson series) a member teaches or trains in, within the window.
export interface MemberAcademyGroup {
  seriesId: string
  title: string
  sport: string
  type: string
  color: string
  sessionCount: number
  minutes: number
  // Learning side only: the member's own enrolment state in this group.
  enrollmentStatus: string | null
}

export interface MemberAcademyLoad {
  minutes: number
  sessionCount: number
  // Weekday × hour grid (flat, 168) — the same shape court utilization renders.
  heatmap: number[]
  peakBucket: { weekday: number, hour: number, minutes: number } | null
  groups: MemberAcademyGroup[]
}

export interface MemberAcademyLearning extends MemberAcademyLoad {
  attendance: import('../../shared/member-academy').AttendanceTally
  // null = nothing marked yet (renders as "—", not 0%).
  attendanceRate: number | null
}

// A member's Academy engagement over [from, to) — the two lenses of one person:
// `teaching` when they can coach, `learning` when they're a student. A member is
// never both, so exactly one is populated (or neither, e.g. a non-coaching admin).
export interface MemberAcademyDto {
  from: Date
  to: Date
  timezone: string
  teaching: MemberAcademyLoad | null
  learning: MemberAcademyLearning | null
}

// ─── Consent (RODO/GDPR) ─────────────────────────────────────────────────────

// One consent purpose as the staff sees it. `state` is derived: no row = 'unknown'
// ("never asked"), which is deliberately not the same as 'withdrawn'.
export interface MemberConsentDto {
  type: string
  state: import('../../shared/member-consent').ConsentState
  grantedAt: Date | null
  withdrawnAt: Date | null
  grantedByName: string | null
  guardianId: string | null
  documentVersion: string | null
  notes: string | null
  // True when this member is a minor, so the decision must come from a guardian.
  requiresGuardian: boolean
}

// ─── Audit log ───────────────────────────────────────────────────────────────

// One governance audit entry as the client reads it. `action` is a stable key
// (AUDIT_ACTIONS); `data` carries the interpolation params (incl. the snapshotted
// `actorName`) the client renders the localized line from. Org id is not exposed.
export interface AuditEntryDto {
  id: string
  action: string
  actorMemberId: string | null
  targetMemberId: string | null
  data: Record<string, string | number | null> | null
  createdAt: Date
}

// A page of the org-wide audit feed. **Keyset**-paginated, not OFFSET: this is an
// append-only log, so new entries arriving at the head would shift an OFFSET
// window and make the reader skip or repeat rows. The cursor encodes the last
// row's (createdAt, id) tuple — id breaks timestamp ties. null = end of feed.
export interface AuditFeedResult {
  entries: AuditEntryDto[]
  nextCursor: string | null
}

export type OrgProfile = typeof import('./app-schema').orgProfile.$inferSelect

// The editable subset of the profile (everything except the org id and the
// managed timestamps). Both the PATCH body and the service `set` are typed
// against this so a new column is wired through in one place.
export type OrgProfileInput = Omit<OrgProfile, 'organizationId' | 'createdAt' | 'updatedAt'>

export type Court = typeof import('./app-schema').court.$inferSelect
export type CourtZone = typeof import('./app-schema').courtZone.$inferSelect

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
  zoneId: string | null
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

// A facility zone (area/hall) — the client-facing shape (org id + audit columns
// dropped, like CourtDto). `courtCount` is folded in by the list query.
export interface CourtZoneDto {
  id: string
  name: string
  sortOrder: number
  courtCount: number
}

// A court's utilization over [from, to) — computed from the CORE reservation
// primitive (product-neutral; a future Courtto `booking` counts as usage). Wraps
// the pure UtilizationStats with the window + zone it was computed against.
export interface CourtUtilizationDto {
  from: Date
  to: Date
  timezone: string
  operating: { open: number, close: number }
  usageMinutes: number
  downtimeMinutes: number
  usageCount: number
  dayCount: number
  utilizationPct: number
  heatmap: number[]
  peakBucket: { weekday: number, hour: number, minutes: number } | null
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
