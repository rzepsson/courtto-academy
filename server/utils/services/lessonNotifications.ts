import { env } from 'node:process'
import { and, asc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm'
import { db } from '../db'
import { enrollment, lessonSeries, lessonSession, memberGuardian, memberProfile } from '../../database/app-schema'
import { member, organization, user } from '../../database/schema'
import { createNotification } from './notifications'
import { getOrgProfile } from './orgProfile'
import { sendMail } from '../mailer'
import {
  renderLessonCancelledEmail,
  renderLessonReminderEmail,
  renderLessonRescheduledEmail,
  renderWaitlistPromotedEmail,
  toEmailLocale,
  type EmailLocale,
  type RenderedEmail
} from '../../../shared/email'
import { isMinor } from '../../../shared/member-guardian'
import type { NotificationType } from '../../../shared/notifications'
import { captureError } from '../monitoring'

// Fans lesson events (cancel / reschedule / waitlist-promotion / reminder) out to
// the people they affect — the enrolled students, the assigned coach, and (for a
// minor) the student's primary guardian by email — over BOTH the in-app bell and
// email. This is what makes the product the school's system of record: a cancelled
// lesson reaches the parent instead of a parallel WhatsApp group.
//
// Every public function is BEST-EFFORT: it swallows its own errors so a
// notification failure can never fail the governing action (a cancel still
// cancels). Per-recipient delivery is isolated too, so one bad address doesn't
// stop the rest. Guardians get email only (they have no account, hence no bell).

const STUDENT_LINK = '/my/lessons'
const COACH_LINK = '/coach/schedule'

// Reminders fire ~a day out; the sweep runs hourly (see the scheduled task), and
// the per-(session,user) dedupe key makes overlapping windows harmless.
const REMINDER_WINDOW_HOURS = 24
const REMINDER_BATCH = 500

function appOrigin(): string {
  return (env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    captureError(error, { scope: `lessonNotifications.${label}` })
  }
}

interface SessionContext {
  seriesId: string
  lessonTitle: string
  startsAt: Date
  timezone: string
  coachMemberId: string | null
  schoolName: string
  locale: EmailLocale
}

interface StudentRecipient {
  studentMemberId: string
  userId: string
  email: string
  guardianEmail: string | null
}

// Resolve a session's series/school context. Null when the session isn't this
// org's (tenant isolation — every query scoped by organizationId).
async function loadSessionContext(organizationId: string, sessionId: string): Promise<SessionContext | null> {
  const [row] = await db
    .select({
      seriesId: lessonSession.seriesId,
      seriesTitle: lessonSeries.title,
      startsAt: lessonSession.startsAt,
      timezone: lessonSeries.timezone,
      coachMemberId: lessonSession.coachMemberId,
      schoolName: organization.name
    })
    .from(lessonSession)
    .innerJoin(lessonSeries, eq(lessonSession.seriesId, lessonSeries.id))
    .innerJoin(organization, eq(lessonSession.organizationId, organization.id))
    .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, sessionId)))
    .limit(1)
  if (!row) return null

  const profile = await getOrgProfile(organizationId)
  return {
    seriesId: row.seriesId,
    lessonTitle: row.seriesTitle,
    startsAt: row.startsAt,
    timezone: row.timezone,
    coachMemberId: row.coachMemberId,
    schoolName: row.schoolName,
    locale: toEmailLocale(profile.locale)
  }
}

// The enrolled (seat-holding) students for a session — series enrolees and drop-ins
// — each with their account + email, and the primary guardian's email when the
// student is a minor. Scoped by organizationId.
async function resolveSessionStudents(organizationId: string, seriesId: string, sessionId: string): Promise<StudentRecipient[]> {
  const rows = await db
    .select({
      studentMemberId: enrollment.studentMemberId,
      userId: user.id,
      email: user.email,
      dateOfBirth: memberProfile.dateOfBirth
    })
    .from(enrollment)
    .innerJoin(member, eq(enrollment.studentMemberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(and(
      eq(enrollment.organizationId, organizationId),
      eq(enrollment.status, 'enrolled'),
      or(eq(enrollment.seriesId, seriesId), eq(enrollment.sessionId, sessionId))
    ))

  // Dedupe by student (a student can't hold both a series seat and a drop-in for
  // the same session, but guard anyway).
  const byMember = new Map<string, { userId: string, email: string, dateOfBirth: string | null }>()
  for (const row of rows) {
    if (!byMember.has(row.studentMemberId)) {
      byMember.set(row.studentMemberId, { userId: row.userId, email: row.email, dateOfBirth: row.dateOfBirth })
    }
  }

  const minorIds = [...byMember].filter(([, v]) => isMinor(v.dateOfBirth)).map(([id]) => id)
  const guardianEmail = await primaryGuardianEmails(organizationId, minorIds)

  return [...byMember].map(([studentMemberId, v]) => ({
    studentMemberId,
    userId: v.userId,
    email: v.email,
    guardianEmail: guardianEmail.get(studentMemberId) ?? null
  }))
}

// The primary guardian email per member, for the given (minor) members. A guardian
// may be phone-only, so the email can be absent even when a primary exists.
async function primaryGuardianEmails(organizationId: string, memberIds: string[]): Promise<Map<string, string | null>> {
  if (memberIds.length === 0) return new Map()
  const rows = await db
    .select({ memberId: memberGuardian.memberId, email: memberGuardian.email })
    .from(memberGuardian)
    .where(and(
      eq(memberGuardian.organizationId, organizationId),
      inArray(memberGuardian.memberId, memberIds),
      eq(memberGuardian.isPrimary, true)
    ))
  return new Map(rows.map(r => [r.memberId, r.email]))
}

async function resolveCoach(organizationId: string, coachMemberId: string | null): Promise<{ userId: string, email: string } | null> {
  if (!coachMemberId) return null
  const [row] = await db
    .select({ userId: user.id, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.id, coachMemberId)))
    .limit(1)
  return row ?? null
}

// One recipient's delivery: a bell row (when they have an account) + an email.
// Isolated best-effort — a single failure is logged and never propagates.
async function deliver(input: {
  organizationId: string
  userId: string | null
  email: string | null
  notification: { type: NotificationType, data: Record<string, string>, link: string } | null
  rendered: RenderedEmail | null
}): Promise<void> {
  if (input.userId && input.notification) {
    await safe('bell', () => createNotification({
      userId: input.userId!,
      organizationId: input.organizationId,
      type: input.notification!.type,
      data: input.notification!.data,
      link: input.notification!.link
    }).then(() => undefined))
  }
  if (input.email && input.rendered) {
    const rendered = input.rendered
    const to = input.email
    await safe('email', () => sendMail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text }))
  }
}

// Cancel + reschedule share the same audience (students + guardians + coach) and
// differ only in the notification type and the rendered email — factored here.
async function notifySessionEvent(
  organizationId: string,
  sessionId: string,
  build: (ctx: SessionContext, audience: 'student' | 'coach') => { type: NotificationType, email: RenderedEmail }
): Promise<void> {
  const ctx = await loadSessionContext(organizationId, sessionId)
  if (!ctx) return

  const students = await resolveSessionStudents(organizationId, ctx.seriesId, sessionId)
  const data = { lessonTitle: ctx.lessonTitle }

  for (const s of students) {
    const { type, email } = build(ctx, 'student')
    await deliver({
      organizationId,
      userId: s.userId,
      email: s.email,
      notification: { type, data, link: STUDENT_LINK },
      rendered: email
    })
    if (s.guardianEmail) {
      await deliver({ organizationId, userId: null, email: s.guardianEmail, notification: null, rendered: email })
    }
  }

  const coach = await resolveCoach(organizationId, ctx.coachMemberId)
  if (coach) {
    const { type, email } = build(ctx, 'coach')
    await deliver({
      organizationId,
      userId: coach.userId,
      email: coach.email,
      notification: { type, data, link: COACH_LINK },
      rendered: email
    })
  }
}

export async function notifyLessonCancelled(
  organizationId: string,
  sessionId: string,
  opts: { reason?: string | null } = {}
): Promise<void> {
  await safe('cancelled', () =>
    notifySessionEvent(organizationId, sessionId, (ctx, audience) => ({
      type: 'lesson.cancelled',
      email: renderLessonCancelledEmail({
        locale: ctx.locale,
        schoolName: ctx.schoolName,
        lessonTitle: ctx.lessonTitle,
        timezone: ctx.timezone,
        startsAt: ctx.startsAt,
        reason: opts.reason ?? null,
        ctaUrl: appOrigin() + (audience === 'coach' ? COACH_LINK : STUDENT_LINK)
      })
    })))
}

export async function notifyLessonRescheduled(
  organizationId: string,
  sessionId: string,
  opts: { previousStartsAt: Date }
): Promise<void> {
  await safe('rescheduled', () =>
    notifySessionEvent(organizationId, sessionId, (ctx, audience) => ({
      type: 'lesson.rescheduled',
      email: renderLessonRescheduledEmail({
        locale: ctx.locale,
        schoolName: ctx.schoolName,
        lessonTitle: ctx.lessonTitle,
        timezone: ctx.timezone,
        previousStartsAt: opts.previousStartsAt,
        startsAt: ctx.startsAt,
        ctaUrl: appOrigin() + (audience === 'coach' ? COACH_LINK : STUDENT_LINK)
      })
    })))
}

// A freed seat promoted one waitlisted student — tell just that student (+ their
// guardian). Series- or session-scoped; either id resolves the lesson title.
export async function notifyWaitlistPromoted(
  organizationId: string,
  studentMemberId: string,
  scope: { seriesId: string | null, sessionId: string | null }
): Promise<void> {
  await safe('promoted', async () => {
    const title = await resolveScopeTitle(organizationId, scope)
    if (!title) return
    const profile = await getOrgProfile(organizationId)
    const locale = toEmailLocale(profile.locale)
    const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId)).limit(1)
    if (!org) return

    const recipient = await resolveStudent(organizationId, studentMemberId)
    if (!recipient) return

    const email = renderWaitlistPromotedEmail({ locale, schoolName: org.name, lessonTitle: title, ctaUrl: appOrigin() + STUDENT_LINK })
    await deliver({
      organizationId,
      userId: recipient.userId,
      email: recipient.email,
      notification: { type: 'enrollment.waitlist_promoted', data: { lessonTitle: title }, link: STUDENT_LINK },
      rendered: email
    })
    if (recipient.guardianEmail) {
      await deliver({ organizationId, userId: null, email: recipient.guardianEmail, notification: null, rendered: email })
    }
  })
}

async function resolveScopeTitle(organizationId: string, scope: { seriesId: string | null, sessionId: string | null }): Promise<string | null> {
  if (scope.seriesId) {
    const [row] = await db
      .select({ title: lessonSeries.title })
      .from(lessonSeries)
      .where(and(eq(lessonSeries.organizationId, organizationId), eq(lessonSeries.id, scope.seriesId)))
      .limit(1)
    return row?.title ?? null
  }
  if (scope.sessionId) {
    const [row] = await db
      .select({ seriesTitle: lessonSeries.title })
      .from(lessonSession)
      .innerJoin(lessonSeries, eq(lessonSession.seriesId, lessonSeries.id))
      .where(and(eq(lessonSession.organizationId, organizationId), eq(lessonSession.id, scope.sessionId)))
      .limit(1)
    return row?.seriesTitle ?? null
  }
  return null
}

async function resolveStudent(organizationId: string, studentMemberId: string): Promise<StudentRecipient | null> {
  const [row] = await db
    .select({ userId: user.id, email: user.email, dateOfBirth: memberProfile.dateOfBirth })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.id, studentMemberId)))
    .limit(1)
  if (!row) return null

  const guardianEmail = isMinor(row.dateOfBirth)
    ? (await primaryGuardianEmails(organizationId, [studentMemberId])).get(studentMemberId) ?? null
    : null
  return { studentMemberId, userId: row.userId, email: row.email, guardianEmail }
}

// Sweep upcoming sessions across ALL tenants and remind their enrolled students
// (+ guardians). Idempotent: each student's reminder is a bell row deduped per
// (user, session), so a session is only emailed the first time its student is
// reminded — overlapping hourly windows never double-send. Bounded per run;
// per-session failures are isolated. Idempotent + bounded, so concurrent runs are
// safe (just wasteful); cross-instance single-flight is the scaling seam (mirrors
// the materialization sweep). Coaches aren't reminded — they own their schedule.
export async function runLessonReminderSweep(now: Date = new Date()): Promise<{ scanned: number, reminded: number }> {
  const until = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000)

  const sessions = await db
    .select({ id: lessonSession.id, organizationId: lessonSession.organizationId })
    .from(lessonSession)
    .where(and(
      gte(lessonSession.startsAt, now),
      lt(lessonSession.startsAt, until),
      ne(lessonSession.status, 'cancelled')
    ))
    .orderBy(asc(lessonSession.startsAt))
    .limit(REMINDER_BATCH)

  let reminded = 0
  for (const session of sessions) {
    await safe(`reminder:${session.id}`, async () => {
      reminded += await remindSession(session.organizationId, session.id)
    })
  }
  return { scanned: sessions.length, reminded }
}

async function remindSession(organizationId: string, sessionId: string): Promise<number> {
  const ctx = await loadSessionContext(organizationId, sessionId)
  if (!ctx) return 0

  const students = await resolveSessionStudents(organizationId, ctx.seriesId, sessionId)
  if (students.length === 0) return 0

  const email = renderLessonReminderEmail({
    locale: ctx.locale,
    schoolName: ctx.schoolName,
    lessonTitle: ctx.lessonTitle,
    timezone: ctx.timezone,
    startsAt: ctx.startsAt,
    ctaUrl: appOrigin() + STUDENT_LINK
  })
  const dedupeKey = `lesson.reminder:${sessionId}`

  let sent = 0
  for (const s of students) {
    // The bell insert is the idempotency gate: only email (student + guardian) the
    // first time this student is reminded for this session.
    let created = false
    await safe('reminder-bell', async () => {
      created = await createNotification({
        userId: s.userId,
        organizationId,
        type: 'lesson.reminder',
        data: { lessonTitle: ctx.lessonTitle },
        link: STUDENT_LINK,
        dedupeKey
      })
    })
    if (!created) continue

    sent += 1
    await safe('reminder-email', () => sendMail({ to: s.email, subject: email.subject, html: email.html, text: email.text }))
    if (s.guardianEmail) {
      const guardianEmail = s.guardianEmail
      await safe('reminder-guardian-email', () => sendMail({ to: guardianEmail, subject: email.subject, html: email.html, text: email.text }))
    }
  }
  return sent
}
