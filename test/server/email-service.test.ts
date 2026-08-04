import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { auth } from '../../server/utils/auth'
import { clearMailTransport, isMailerConfigured, setMailTransport, type OutgoingMail } from '../../server/utils/mailer'
import { sendMemberInvitationEmail, sendPasswordResetEmail } from '../../server/utils/services/email'
import { upsertOrgProfile } from '../../server/utils/services/orgProfile'
import { createOrg, hasTestDb, resetDb, signUp, uniqueEmail } from './helpers'

// The recording transport (rule of the testing bar: never send real mail — inject
// a fake and assert on what would have been sent). Registered fresh per test.
const outbox: OutgoingMail[] = []

describe.skipIf(!hasTestDb)('email layer', () => {
  beforeEach(async () => {
    await resetDb()
    outbox.length = 0
    setMailTransport({
      name: 'recording',
      async send(mail) {
        outbox.push(mail)
      }
    })
  })

  afterAll(() => {
    clearMailTransport()
  })

  it('is unconfigured in the test environment (falls back to the console transport)', () => {
    expect(isMailerConfigured()).toBe(false)
  })

  it('renders the password reset email in the request locale', async () => {
    await sendPasswordResetEmail({
      to: 'jane@example.com',
      recipientName: 'Jane',
      url: 'https://app.test/api/auth/reset-password/tok-abc?callbackURL=%2Freset-password',
      request: new Request('https://app.test/', { headers: { 'accept-language': 'pl-PL,en;q=0.8' } })
    })

    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.to).toBe('jane@example.com')
    expect(outbox[0]!.subject).toBe('Zresetuj hasło do Courtto Academy')
    expect(outbox[0]!.text).toContain('reset-password/tok-abc')
  })

  it('writes the invitation email in the school locale and links to the invite page', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace', slug: `org-${randomUUID().slice(0, 8)}` })
    await upsertOrgProfile(orgId, { locale: 'pl' })

    await sendMemberInvitationEmail({
      to: 'newcoach@example.com',
      organizationId: orgId,
      schoolName: 'Ace',
      inviterName: 'Owner',
      role: 'coach',
      invitationId: 'inv-42',
      expiresAt: new Date('2026-08-01T10:00:00Z')
    })

    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.to).toBe('newcoach@example.com')
    expect(outbox[0]!.subject).toBe('Zaproszenie do Ace w Courtto Academy')
    expect(outbox[0]!.text).toContain('/invite/inv-42')
  })

  it('drives the real reset flow end-to-end and stays enumeration-safe', async () => {
    const user = await signUp({ email: uniqueEmail(), password: 'password123' })

    // A non-existent account gets the same success response, but no mail is sent.
    const ghost = await auth.api.requestPasswordReset({
      body: { email: uniqueEmail('ghost'), redirectTo: '/reset-password' }
    })
    expect(ghost.status).toBe(true)
    expect(outbox).toHaveLength(0)

    // The real account: exactly one mail, addressed to them.
    const real = await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: '/reset-password' }
    })
    expect(real.status).toBe(true)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.to).toBe(user.email)

    // The emailed link carries a token that actually resets the password.
    const token = outbox[0]!.text.match(/reset-password\/([^?\s]+)/)?.[1]
    expect(token).toBeTruthy()
    const reset = await auth.api.resetPassword({ body: { newPassword: 'newpassword456', token: token! } })
    expect(reset.status).toBe(true)

    // The new password now signs in.
    const signIn = await auth.api.signInEmail({ body: { email: user.email, password: 'newpassword456' } })
    expect(signIn.user.email).toBe(user.email)
  })

  it('emails an invitation on create without blocking creation (copyable link survives)', async () => {
    const owner = await signUp()
    const orgId = await createOrg(owner, { name: 'Ace Academy', slug: `org-${randomUUID().slice(0, 8)}` })
    await upsertOrgProfile(orgId, { locale: 'en' })
    const inviteeEmail = uniqueEmail('coach')

    const invitation = await auth.api.createInvitation({
      body: { email: inviteeEmail, role: 'coach', organizationId: orgId },
      headers: owner.headers
    })

    // The invitation exists (the copyable /invite/[id] link still works)...
    expect(invitation.id).toBeTruthy()
    // ...and the additive email went out, in the school's locale, to the invitee.
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.to).toBe(inviteeEmail)
    expect(outbox[0]!.subject).toBe('You’re invited to join Ace Academy on Courtto Academy')
    expect(outbox[0]!.text).toContain(`/invite/${invitation.id}`)
  })
})
