import { env } from 'node:process'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { enrollment, lessonSeries } from '../../database/app-schema'
import { member, organization, user } from '../../database/schema'
import { createNotification } from './notifications'
import { getOrgProfile } from './orgProfile'
import { sendMail } from '../mailer'
import { renderPaymentFailedEmail, toEmailLocale } from '../../../shared/email'
import { captureError } from '../monitoring'

// Alerts school STAFF (owner + admins) when a student's monthly payment fails — over
// the in-app bell AND email. The PAYER is NOT notified from here: Stripe sends its
// own dunning email to the customer and retries automatically (the locked policy is
// "flag + notify staff, staff decides"; access is never gated on payment).
//
// Best-effort like lessonNotifications: it swallows its own errors so a notification
// failure can never fail the webhook that triggered it, and per-recipient delivery
// is isolated so one bad address doesn't stop the rest.

function appOrigin(): string {
  return (env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

async function safe(label: string, organizationId: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    captureError(error, { scope: `paymentNotifications.${label}`, organizationId })
  }
}

export async function notifyPaymentFailed(organizationId: string, enrollmentId: string): Promise<void> {
  const [context] = await db
    .select({ studentName: user.name, groupTitle: lessonSeries.title })
    .from(enrollment)
    .innerJoin(member, eq(enrollment.studentMemberId, member.id))
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(lessonSeries, eq(enrollment.seriesId, lessonSeries.id))
    .where(and(eq(enrollment.organizationId, organizationId), eq(enrollment.id, enrollmentId)))
    .limit(1)
  if (!context) {
    return
  }

  const studentName = context.studentName
  const groupTitle = context.groupTitle ?? '—'

  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, organizationId)).limit(1)
  const schoolName = org?.name ?? 'Courtto'
  const profile = await getOrgProfile(organizationId)
  const locale = toEmailLocale(profile.locale)

  // Recipients: everyone who runs the school (owner + admins).
  const staff = await db
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, organizationId), inArray(member.role, ['owner', 'admin'])))

  for (const recipient of staff) {
    await safe('bell', organizationId, () =>
      createNotification({
        userId: recipient.userId,
        organizationId,
        type: 'billing.payment_failed',
        data: { studentName, groupTitle },
        link: '/school/schedule'
      }).then(() => undefined)
    )

    await safe('email', organizationId, async () => {
      const email = renderPaymentFailedEmail({ locale, schoolName, studentName, groupTitle, ctaUrl: `${appOrigin()}/school/schedule` })
      await sendMail({ to: recipient.email, subject: email.subject, html: email.html, text: email.text })
    })
  }
}
