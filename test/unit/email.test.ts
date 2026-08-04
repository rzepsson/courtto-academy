import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMAIL_LOCALE,
  escapeHtml,
  renderInvitationEmail,
  renderLessonCancelledEmail,
  renderLessonReminderEmail,
  renderLessonRescheduledEmail,
  renderPasswordResetEmail,
  renderWaitlistPromotedEmail,
  resolveEmailLocale,
  toEmailLocale
} from '../../shared/email'

describe('resolveEmailLocale', () => {
  it('prefers the UI-language cookie when it is a supported locale', () => {
    expect(resolveEmailLocale({ cookieHeader: 'foo=1; courtto_locale=pl; bar=2' })).toBe('pl')
    expect(resolveEmailLocale({ cookieHeader: 'courtto_locale=en', acceptLanguage: 'pl' })).toBe('en')
  })

  it('falls back to Accept-Language, honoring q-weights and region subtags', () => {
    expect(resolveEmailLocale({ acceptLanguage: 'pl-PL,en;q=0.8' })).toBe('pl')
    expect(resolveEmailLocale({ acceptLanguage: 'fr-FR,en-GB;q=0.9,pl;q=0.5' })).toBe('en')
  })

  it('ignores an unsupported cookie/header value and uses the default', () => {
    expect(resolveEmailLocale({ cookieHeader: 'courtto_locale=de' })).toBe(DEFAULT_EMAIL_LOCALE)
    expect(resolveEmailLocale({ acceptLanguage: 'de-DE,fr;q=0.8' })).toBe(DEFAULT_EMAIL_LOCALE)
    expect(resolveEmailLocale({})).toBe(DEFAULT_EMAIL_LOCALE)
  })

  it('respects an explicit fallback', () => {
    expect(resolveEmailLocale({}, 'pl')).toBe('pl')
  })
})

describe('toEmailLocale', () => {
  it('passes through supported values and coerces the rest', () => {
    expect(toEmailLocale('pl')).toBe('pl')
    expect(toEmailLocale('en')).toBe('en')
    expect(toEmailLocale(null)).toBe(DEFAULT_EMAIL_LOCALE)
    expect(toEmailLocale('klingon')).toBe(DEFAULT_EMAIL_LOCALE)
    expect(toEmailLocale('de', 'pl')).toBe('pl')
  })
})

describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<b>"O\'Neil" & Co</b>')).toBe('&lt;b&gt;&quot;O&#39;Neil&quot; &amp; Co&lt;/b&gt;')
  })
})

describe('renderPasswordResetEmail', () => {
  const url = 'https://app.courtto.test/api/auth/reset-password/tok-123?callbackURL=%2Freset-password'

  it('renders an English message carrying the reset link in both html and text', () => {
    const mail = renderPasswordResetEmail({ locale: 'en', recipientName: 'Jane', url })
    expect(mail.subject).toBe('Reset your Courtto Academy password')
    expect(mail.text).toContain('Hi Jane,')
    expect(mail.text).toContain(url)
    expect(mail.html).toContain(`href="${url}"`)
    expect(mail.html).toContain('Reset password')
  })

  it('renders a Polish message when the locale is pl', () => {
    const mail = renderPasswordResetEmail({ locale: 'pl', recipientName: null, url })
    expect(mail.subject).toBe('Zresetuj hasło do Courtto Academy')
    expect(mail.text).toContain('Cześć,')
    expect(mail.text).toContain(url)
  })

  it('escapes a hostile recipient name in the HTML body but not the text', () => {
    const mail = renderPasswordResetEmail({ locale: 'en', recipientName: '<script>x</script>', url })
    expect(mail.html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(mail.html).not.toContain('<script>x</script>')
    expect(mail.text).toContain('<script>x</script>')
  })
})

describe('renderInvitationEmail', () => {
  const base = {
    schoolName: 'Ace Tennis',
    inviterName: 'Coach Carl',
    acceptUrl: 'https://app.courtto.test/invite/inv-9',
    expiresAt: new Date('2026-08-01T10:00:00Z')
  }

  it('names the school, the inviter and a localized role, and links to the invite page', () => {
    const mail = renderInvitationEmail({ locale: 'en', role: 'coach', ...base })
    expect(mail.subject).toBe('You’re invited to join Ace Tennis on Courtto Academy')
    expect(mail.text).toContain('Coach Carl has invited you to join Ace Tennis')
    expect(mail.text).toContain('as a coach')
    expect(mail.text).toContain(base.acceptUrl)
    expect(mail.html).toContain(`href="${base.acceptUrl}"`)
  })

  it('localizes the role label and copy in Polish', () => {
    const mail = renderInvitationEmail({ locale: 'pl', role: 'student', ...base })
    expect(mail.subject).toBe('Zaproszenie do Ace Tennis w Courtto Academy')
    expect(mail.text).toContain('jako uczeń')
  })

  it('escapes a hostile school name in the HTML', () => {
    const mail = renderInvitationEmail({ locale: 'en', role: 'admin', ...base, schoolName: '<img src=x>' })
    expect(mail.html).toContain('&lt;img src=x&gt;')
    expect(mail.html).not.toContain('<img src=x>')
  })
})

describe('lesson notification emails', () => {
  const base = {
    schoolName: 'Ace Tennis',
    lessonTitle: 'Junior Group',
    timezone: 'Europe/Warsaw',
    ctaUrl: 'https://app.courtto.test/my/lessons'
  }
  const startsAt = new Date('2026-09-07T15:00:00Z') // 17:00 Warsaw (CEST)

  it('renders a cancellation with the localized time and the reason', () => {
    const mail = renderLessonCancelledEmail({ locale: 'en', ...base, startsAt, reason: 'Coach ill' })
    expect(mail.subject).toBe('Cancelled: Junior Group')
    expect(mail.text).toContain('Junior Group')
    expect(mail.text).toContain('Ace Tennis')
    expect(mail.text).toContain('17:00') // resolved in Europe/Warsaw, not UTC
    expect(mail.text).toContain('Coach ill')
  })

  it('omits the reason line when there is none', () => {
    const mail = renderLessonCancelledEmail({ locale: 'en', ...base, startsAt, reason: null })
    expect(mail.text).not.toContain('Reason:')
  })

  it('renders a reschedule with both the old and new time (localized)', () => {
    const mail = renderLessonRescheduledEmail({
      locale: 'pl',
      ...base,
      previousStartsAt: startsAt,
      startsAt: new Date('2026-09-07T17:00:00Z') // 19:00 Warsaw
    })
    expect(mail.subject).toBe('Zmiana terminu: Junior Group')
    expect(mail.text).toContain('19:00') // new
    expect(mail.text).toContain('17:00') // was
  })

  it('renders a reminder and a promotion (promotion carries no single time)', () => {
    const reminder = renderLessonReminderEmail({ locale: 'en', ...base, startsAt })
    expect(reminder.subject).toBe('Reminder: Junior Group')
    expect(reminder.text).toContain('17:00')

    const promoted = renderWaitlistPromotedEmail({ locale: 'en', schoolName: base.schoolName, lessonTitle: base.lessonTitle, ctaUrl: base.ctaUrl })
    expect(promoted.text).toContain('Junior Group')
    expect(promoted.text).not.toMatch(/\d{2}:\d{2}/) // no clock time
  })

  it('escapes a hostile lesson title in the HTML body', () => {
    const mail = renderLessonCancelledEmail({ locale: 'en', ...base, lessonTitle: '<b>x</b>', startsAt, reason: null })
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(mail.html).not.toContain('<b>x</b>')
  })
})
