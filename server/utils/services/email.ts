import { env } from 'node:process'
// Explicit imports (no Nuxt auto-imports): this module is reachable from
// server/utils/auth.ts (sendResetPassword / sendInvitationEmail), which the
// `auth` CLI loads outside of Nuxt.
import { sendMail } from '../mailer'
import { getOrgProfile } from './orgProfile'
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  resolveEmailLocale,
  toEmailLocale
} from '../../../shared/email'
import type { OrgRole } from '../../../shared/permissions'

// The app origin the invite link points at. BETTER_AUTH_URL is the app URL (the
// same origin Better Auth builds its own reset link on), never the /api/auth base.
function appOrigin(): string {
  return (env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

// A password reset has no org context, so its language is resolved from the
// request (the UI-language cookie, then Accept-Language), falling back to the
// app's default locale. Better Auth builds the `url` (it points at its own
// /reset-password/:token callback, which validates the token then redirects to
// the /reset-password page); we only render and send.
export async function sendPasswordResetEmail(input: {
  to: string
  recipientName: string | null
  url: string
  request?: Request
}): Promise<void> {
  const locale = resolveEmailLocale({
    cookieHeader: input.request?.headers.get('cookie'),
    acceptLanguage: input.request?.headers.get('accept-language')
  })

  const email = renderPasswordResetEmail({ locale, recipientName: input.recipientName, url: input.url })
  await sendMail({ to: input.to, subject: email.subject, html: email.html, text: email.text })
}

// An invitation has an org context, so it's written in the school's configured
// notification language (orgProfile.locale). The email is additive: it links to
// the existing /invite/[id] landing page (accept / decline / sign-in-or-up), the
// same URL the copyable admin link uses — so the copyable link keeps working
// unchanged and the mail is just a second delivery channel.
export async function sendMemberInvitationEmail(input: {
  to: string
  organizationId: string
  schoolName: string
  inviterName: string
  role: OrgRole
  invitationId: string
  expiresAt: Date
}): Promise<void> {
  const profile = await getOrgProfile(input.organizationId)
  const locale = toEmailLocale(profile.locale)

  const email = renderInvitationEmail({
    locale,
    schoolName: input.schoolName,
    inviterName: input.inviterName,
    role: input.role,
    acceptUrl: `${appOrigin()}/invite/${input.invitationId}`,
    expiresAt: input.expiresAt
  })
  await sendMail({ to: input.to, subject: email.subject, html: email.html, text: email.text })
}
