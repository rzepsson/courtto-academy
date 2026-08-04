// The transactional-email content layer: locale resolution, the localized copy
// catalog, and pure render functions that turn an email's inputs into a ready
// `{ subject, html, text }`. Kept free of Nuxt/Node imports so it loads in any
// context and is unit-testable by rendering to a string and asserting on it.
//
// Why a server-side catalog and NOT the vue-i18n locale files: this copy is only
// ever rendered on the server (Nitro sends the mail), so putting it in
// `i18n/locales/*.json` would ship every subject line and legal footer to every
// browser via vue-i18n, and `server/utils/auth.ts` — which calls the renderers —
// is loaded by the `auth` CLI *outside* Nuxt, where vue-i18n isn't available.
// This module is the one place all email text lives (rule 5's intent, for text
// the client never sees).

import type { OrgRole } from './permissions'

export const EMAIL_LOCALES = ['en', 'pl'] as const
export type EmailLocale = (typeof EMAIL_LOCALES)[number]

// A password reset carries no org context, so its language can't come from
// orgProfile.locale. It falls back to the app's i18n defaultLocale ('en', see
// nuxt.config.ts) when the request gives no usable signal.
export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'en'

// Must match the i18n cookieKey in nuxt.config.ts — the user's chosen UI language
// is the best signal for which language to write to them in.
const LOCALE_COOKIE = 'courtto_locale'

function isEmailLocale(value: string): value is EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(value)
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.split('=')
    if (rawKey?.trim() === name) {
      return decodeURIComponent(rest.join('=').trim())
    }
  }
  return null
}

// Ordered list of language subtags from an Accept-Language header, most-preferred
// first (q-weight aware). 'pl-PL,en;q=0.8' -> ['pl', 'en'].
function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params
        .map(p => p.trim())
        .find(p => p.startsWith('q='))
      const weight = q ? Number.parseFloat(q.slice(2)) : 1
      return { lang: tag.trim().toLowerCase().split('-')[0] ?? '', weight: Number.isFinite(weight) ? weight : 0 }
    })
    .filter(entry => entry.lang.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .map(entry => entry.lang)
}

// Resolve the language for a request-scoped email (password reset). The explicit
// UI-language cookie wins; then the browser's Accept-Language; then the fallback.
export function resolveEmailLocale(
  signals: { cookieHeader?: string | null, acceptLanguage?: string | null },
  fallback: EmailLocale = DEFAULT_EMAIL_LOCALE
): EmailLocale {
  const cookie = readCookie(signals.cookieHeader, LOCALE_COOKIE)
  if (cookie && isEmailLocale(cookie)) return cookie

  for (const lang of parseAcceptLanguage(signals.acceptLanguage)) {
    if (isEmailLocale(lang)) return lang
  }

  return fallback
}

// Coerce an arbitrary stored locale (e.g. orgProfile.locale) to a supported email
// locale, so an unexpected value can never crash rendering.
export function toEmailLocale(value: string | null | undefined, fallback: EmailLocale = DEFAULT_EMAIL_LOCALE): EmailLocale {
  return value && isEmailLocale(value) ? value : fallback
}

// Interpolated values (school name, inviter/recipient names) are user-controlled,
// so every one is escaped before it lands in the HTML body. Plain text needs no
// escaping.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface Catalog {
  footer: string
  passwordReset: {
    subject: string
    preview: string
    heading: string
    greeting: (name: string | null) => string
    intro: string
    cta: string
    linkFallback: string
    expiry: string
    ignore: string
  }
  invitation: {
    subject: (school: string) => string
    preview: (school: string) => string
    heading: (school: string) => string
    greeting: string
    intro: (inviter: string, school: string, role: string) => string
    cta: string
    linkFallback: string
    expiry: (date: string) => string
    roles: Record<OrgRole, string>
  }
  lesson: {
    cta: string
    linkFallback: string
    cancelled: {
      subject: (title: string) => string
      heading: string
      body: (title: string, school: string, when: string) => string
      reason: (reason: string) => string
    }
    rescheduled: {
      subject: (title: string) => string
      heading: string
      body: (title: string, school: string, newWhen: string) => string
      was: (oldWhen: string) => string
    }
    reminder: {
      subject: (title: string) => string
      heading: string
      body: (title: string, school: string, when: string) => string
    }
    promoted: {
      subject: (title: string) => string
      heading: string
      body: (title: string, school: string) => string
    }
  }
  payment: {
    subject: (group: string) => string
    preview: (group: string) => string
    heading: string
    intro: (student: string, group: string, school: string) => string
    amount: (amount: string) => string
    note: string
    cta: string
    linkFallback: string
  }
  paymentFailed: {
    subject: (student: string) => string
    preview: (student: string) => string
    heading: string
    intro: (student: string, group: string, school: string) => string
    note: string
    cta: string
    linkFallback: string
  }
}

const MESSAGES: Record<EmailLocale, Catalog> = {
  en: {
    footer: 'Courtto Academy · This is an automated message — please don’t reply.',
    passwordReset: {
      subject: 'Reset your Courtto Academy password',
      preview: 'Set a new password for your account.',
      heading: 'Reset your password',
      greeting: name => (name ? `Hi ${name},` : 'Hi,'),
      intro: 'We received a request to reset the password for your Courtto Academy account. Click the button below to choose a new one.',
      cta: 'Reset password',
      linkFallback: 'Or paste this link into your browser:',
      expiry: 'This link expires in 1 hour.',
      ignore: 'If you didn’t request this, you can safely ignore this email — your password won’t change.'
    },
    invitation: {
      subject: school => `You’re invited to join ${school} on Courtto Academy`,
      preview: school => `Accept your invitation to ${school}.`,
      heading: school => `Join ${school}`,
      greeting: 'Hi,',
      intro: (inviter, school, role) => `${inviter} has invited you to join ${school} on Courtto Academy as ${role}.`,
      cta: 'View invitation',
      linkFallback: 'Or paste this link into your browser:',
      expiry: date => `This invitation expires on ${date}.`,
      roles: {
        owner: 'an owner',
        admin: 'an administrator',
        coach: 'a coach',
        student: 'a student'
      }
    },
    lesson: {
      cta: 'View the schedule',
      linkFallback: 'Or paste this link into your browser:',
      cancelled: {
        subject: title => `Cancelled: ${title}`,
        heading: 'Lesson cancelled',
        body: (title, school, when) => `The ${title} lesson at ${school} on ${when} has been cancelled.`,
        reason: reason => `Reason: ${reason}`
      },
      rescheduled: {
        subject: title => `Rescheduled: ${title}`,
        heading: 'Lesson rescheduled',
        body: (title, school, newWhen) => `The ${title} lesson at ${school} has been moved. New time: ${newWhen}.`,
        was: oldWhen => `Previously: ${oldWhen}.`
      },
      reminder: {
        subject: title => `Reminder: ${title}`,
        heading: 'Upcoming lesson',
        body: (title, school, when) => `A reminder from ${school}: the ${title} lesson takes place on ${when}.`
      },
      promoted: {
        subject: title => `You’re enrolled: ${title}`,
        heading: 'You got a spot',
        body: (title, school) => `A place opened up in ${title} at ${school} — you’re now enrolled.`
      }
    },
    payment: {
      subject: group => `Set up payment for ${group}`,
      preview: group => `Monthly payment for ${group}.`,
      heading: 'Monthly payment',
      intro: (student, group, school) => `${school} has set up a monthly plan for ${student}’s place in ${group}.`,
      amount: amount => `${amount} per month.`,
      note: 'Set up your card once and the monthly payment is automatic. You can change or cancel it anytime.',
      cta: 'Set up payment',
      linkFallback: 'Or paste this link into your browser:'
    },
    paymentFailed: {
      subject: student => `Payment failed for ${student}`,
      preview: student => `A monthly payment for ${student} didn't go through.`,
      heading: 'Payment failed',
      intro: (student, group, school) => `A monthly payment for ${student}’s place in ${group} at ${school} has failed.`,
      note: 'Stripe will retry automatically and has already emailed the payer. No action is needed unless it keeps failing — you can manage the subscription in Courtto.',
      cta: 'Open Courtto',
      linkFallback: 'Or paste this link into your browser:'
    }
  },
  pl: {
    footer: 'Courtto Academy · To wiadomość automatyczna — prosimy na nią nie odpowiadać.',
    passwordReset: {
      subject: 'Zresetuj hasło do Courtto Academy',
      preview: 'Ustaw nowe hasło do swojego konta.',
      heading: 'Zresetuj hasło',
      greeting: name => (name ? `Cześć ${name},` : 'Cześć,'),
      intro: 'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta Courtto Academy. Kliknij przycisk poniżej, aby ustawić nowe.',
      cta: 'Zresetuj hasło',
      linkFallback: 'Lub wklej ten link w przeglądarce:',
      expiry: 'Ten link wygasa za godzinę.',
      ignore: 'Jeśli to nie Ty wysłałeś tę prośbę, zignoruj tę wiadomość — Twoje hasło pozostanie bez zmian.'
    },
    invitation: {
      subject: school => `Zaproszenie do ${school} w Courtto Academy`,
      preview: school => `Przyjmij zaproszenie do ${school}.`,
      heading: school => `Dołącz do ${school}`,
      greeting: 'Cześć,',
      intro: (inviter, school, role) => `${inviter} zaprasza Cię do ${school} w Courtto Academy jako ${role}.`,
      cta: 'Zobacz zaproszenie',
      linkFallback: 'Lub wklej ten link w przeglądarce:',
      expiry: date => `To zaproszenie wygasa ${date}.`,
      roles: {
        owner: 'właściciel',
        admin: 'administrator',
        coach: 'trener',
        student: 'uczeń'
      }
    },
    lesson: {
      cta: 'Zobacz plan zajęć',
      linkFallback: 'Lub wklej ten link w przeglądarce:',
      cancelled: {
        subject: title => `Odwołane: ${title}`,
        heading: 'Zajęcia odwołane',
        body: (title, school, when) => `Zajęcia ${title} w ${school} zaplanowane na ${when} zostały odwołane.`,
        reason: reason => `Powód: ${reason}`
      },
      rescheduled: {
        subject: title => `Zmiana terminu: ${title}`,
        heading: 'Zmiana terminu zajęć',
        body: (title, school, newWhen) => `Zajęcia ${title} w ${school} zostały przeniesione. Nowy termin: ${newWhen}.`,
        was: oldWhen => `Poprzednio: ${oldWhen}.`
      },
      reminder: {
        subject: title => `Przypomnienie: ${title}`,
        heading: 'Nadchodzące zajęcia',
        body: (title, school, when) => `Przypomnienie od ${school}: zajęcia ${title} odbędą się ${when}.`
      },
      promoted: {
        subject: title => `Jesteś zapisany(a): ${title}`,
        heading: 'Masz miejsce',
        body: (title, school) => `Zwolniło się miejsce w ${title} w ${school} — jesteś teraz zapisany(a).`
      }
    },
    payment: {
      subject: group => `Ustaw płatność za ${group}`,
      preview: group => `Miesięczna płatność za ${group}.`,
      heading: 'Płatność miesięczna',
      intro: (student, group, school) => `${school} ustawiła miesięczny plan dla miejsca ${student} w grupie ${group}.`,
      amount: amount => `${amount} miesięcznie.`,
      note: 'Ustaw kartę raz — miesięczna płatność będzie automatyczna. Możesz ją zmienić lub anulować w każdej chwili.',
      cta: 'Ustaw płatność',
      linkFallback: 'Lub wklej ten link w przeglądarce:'
    },
    paymentFailed: {
      subject: student => `Nieudana płatność za ${student}`,
      preview: student => `Miesięczna płatność za ${student} nie przeszła.`,
      heading: 'Nieudana płatność',
      intro: (student, group, school) => `Miesięczna płatność za miejsce ${student} w grupie ${group} w ${school} nie powiodła się.`,
      note: 'Stripe automatycznie ponowi próbę i wysłał już e-mail do płatnika. Nie musisz nic robić, chyba że problem się powtarza — subskrypcją zarządzisz w Courtto.',
      cta: 'Otwórz Courtto',
      linkFallback: 'Lub wklej ten link w przeglądarce:'
    }
  }
}

// Brand palette (matches app/assets/css/main.css green ramp). Inlined because
// email clients strip <style>/external CSS and block remote assets.
const BRAND = {
  green: '#00C16A',
  greenDark: '#0A5331',
  greenMid: '#00A155',
  ink: '#1f2933',
  muted: '#6b7280',
  faint: '#9ca3af',
  border: '#e5e7eb',
  page: '#f4f5f7'
}

function wordmark(): string {
  return `<span style="font-weight:700;font-size:18px;letter-spacing:-0.01em;color:${BRAND.greenDark};">Courtto <span style="color:${BRAND.greenMid};">Academy</span></span>`
}

interface ShellParams {
  locale: EmailLocale
  subject: string
  preview: string
  heading: string
  bodyParagraphs: string[]
  ctaLabel: string
  ctaUrl: string
  linkFallback: string
  footnote: string
}

// A single-column, inline-styled, table-based layout — the shape that renders
// reliably across Gmail / Outlook / Apple Mail. No images or remote assets.
function renderShell(params: ShellParams): string {
  const paragraphs = params.bodyParagraphs
    .map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.ink};">${p}</p>`)
    .join('')

  return `<!doctype html>
<html lang="${params.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(params.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-font-smoothing:antialiased;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid ${BRAND.border};overflow:hidden;">
<tr><td style="padding:32px 32px 0;">${wordmark()}</td></tr>
<tr><td style="padding:20px 32px 0;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BRAND.ink};">${escapeHtml(params.heading)}</h1>
${paragraphs}
</td></tr>
<tr><td style="padding:8px 32px 4px;">
<a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;background:${BRAND.green};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:12px 24px;">${escapeHtml(params.ctaLabel)}</a>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
<p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};">${escapeHtml(params.linkFallback)}</p>
<p style="margin:0;font-size:12px;word-break:break-all;"><a href="${escapeHtml(params.ctaUrl)}" style="color:${BRAND.greenMid};">${escapeHtml(params.ctaUrl)}</a></p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid ${BRAND.border};">
<p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.faint};">${escapeHtml(params.footnote)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function renderText(params: {
  heading: string
  bodyParagraphs: string[]
  ctaLabel: string
  ctaUrl: string
  footnote: string
}): string {
  return [
    params.heading,
    '',
    ...params.bodyParagraphs,
    '',
    `${params.ctaLabel}: ${params.ctaUrl}`,
    '',
    '—',
    params.footnote
  ].join('\n')
}

export interface PasswordResetEmailInput {
  locale: EmailLocale
  recipientName: string | null
  url: string
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const m = MESSAGES[input.locale].passwordReset
  const footer = MESSAGES[input.locale].footer
  const textBody = [m.greeting(input.recipientName), m.intro, m.expiry, m.ignore]
  const htmlBody = [
    escapeHtml(m.greeting(input.recipientName)),
    escapeHtml(m.intro),
    escapeHtml(m.expiry),
    escapeHtml(m.ignore)
  ]

  return {
    subject: m.subject,
    html: renderShell({
      locale: input.locale,
      subject: m.subject,
      preview: m.preview,
      heading: m.heading,
      bodyParagraphs: htmlBody,
      ctaLabel: m.cta,
      ctaUrl: input.url,
      linkFallback: m.linkFallback,
      footnote: footer
    }),
    text: renderText({ heading: m.heading, bodyParagraphs: textBody, ctaLabel: m.cta, ctaUrl: input.url, footnote: footer })
  }
}

export interface InvitationEmailInput {
  locale: EmailLocale
  schoolName: string
  inviterName: string
  role: OrgRole
  acceptUrl: string
  expiresAt: Date
}

function formatExpiry(locale: EmailLocale, date: Date): string {
  return new Intl.DateTimeFormat(locale === 'pl' ? 'pl-PL' : 'en-GB', { dateStyle: 'long' }).format(date)
}

export function renderInvitationEmail(input: InvitationEmailInput): RenderedEmail {
  const m = MESSAGES[input.locale].invitation
  const footer = MESSAGES[input.locale].footer
  const roleLabel = m.roles[input.role]
  const expiryLine = m.expiry(formatExpiry(input.locale, input.expiresAt))

  const textBody = [m.greeting, m.intro(input.inviterName, input.schoolName, roleLabel), expiryLine]
  const htmlBody = [
    escapeHtml(m.greeting),
    escapeHtml(m.intro(input.inviterName, input.schoolName, roleLabel)),
    escapeHtml(expiryLine)
  ]

  return {
    subject: m.subject(input.schoolName),
    html: renderShell({
      locale: input.locale,
      subject: m.subject(input.schoolName),
      preview: m.preview(input.schoolName),
      heading: m.heading(input.schoolName),
      bodyParagraphs: htmlBody,
      ctaLabel: m.cta,
      ctaUrl: input.acceptUrl,
      linkFallback: m.linkFallback,
      footnote: footer
    }),
    text: renderText({
      heading: m.heading(input.schoolName),
      bodyParagraphs: textBody,
      ctaLabel: m.cta,
      ctaUrl: input.acceptUrl,
      footnote: footer
    })
  }
}

// A lesson's local wall-clock time, resolved in the school's IANA timezone (the
// email is written in the school's locale, so this is deterministic). Passing the
// zone matters: "17:00 in Warsaw" must read the same wherever the mail is opened.
function formatLessonWhen(locale: EmailLocale, date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(locale === 'pl' ? 'pl-PL' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone
  }).format(date)
}

// Shared builder for the lesson notification emails — same shell/greeting/footer
// as the others, parameterized by the already-localized lines. Every paragraph is
// escaped for the HTML body (title/school/reason are user-controlled).
function buildLessonEmail(
  locale: EmailLocale,
  parts: { subject: string, preview: string, heading: string, paragraphs: string[], ctaUrl: string }
): RenderedEmail {
  const m = MESSAGES[locale].lesson
  const footer = MESSAGES[locale].footer

  return {
    subject: parts.subject,
    html: renderShell({
      locale,
      subject: parts.subject,
      preview: parts.preview,
      heading: parts.heading,
      bodyParagraphs: parts.paragraphs.map(escapeHtml),
      ctaLabel: m.cta,
      ctaUrl: parts.ctaUrl,
      linkFallback: m.linkFallback,
      footnote: footer
    }),
    text: renderText({
      heading: parts.heading,
      bodyParagraphs: parts.paragraphs,
      ctaLabel: m.cta,
      ctaUrl: parts.ctaUrl,
      footnote: footer
    })
  }
}

interface LessonEventBase {
  locale: EmailLocale
  schoolName: string
  lessonTitle: string
  timezone: string
  ctaUrl: string
}

export function renderLessonCancelledEmail(input: LessonEventBase & { startsAt: Date, reason: string | null }): RenderedEmail {
  const m = MESSAGES[input.locale].lesson.cancelled
  const when = formatLessonWhen(input.locale, input.startsAt, input.timezone)
  const paragraphs = [m.body(input.lessonTitle, input.schoolName, when)]
  if (input.reason) paragraphs.push(m.reason(input.reason))
  return buildLessonEmail(input.locale, {
    subject: m.subject(input.lessonTitle),
    preview: m.body(input.lessonTitle, input.schoolName, when),
    heading: m.heading,
    paragraphs,
    ctaUrl: input.ctaUrl
  })
}

export function renderLessonRescheduledEmail(input: LessonEventBase & { previousStartsAt: Date, startsAt: Date }): RenderedEmail {
  const m = MESSAGES[input.locale].lesson.rescheduled
  const newWhen = formatLessonWhen(input.locale, input.startsAt, input.timezone)
  const oldWhen = formatLessonWhen(input.locale, input.previousStartsAt, input.timezone)
  return buildLessonEmail(input.locale, {
    subject: m.subject(input.lessonTitle),
    preview: m.body(input.lessonTitle, input.schoolName, newWhen),
    heading: m.heading,
    paragraphs: [m.body(input.lessonTitle, input.schoolName, newWhen), m.was(oldWhen)],
    ctaUrl: input.ctaUrl
  })
}

export function renderLessonReminderEmail(input: LessonEventBase & { startsAt: Date }): RenderedEmail {
  const m = MESSAGES[input.locale].lesson.reminder
  const when = formatLessonWhen(input.locale, input.startsAt, input.timezone)
  return buildLessonEmail(input.locale, {
    subject: m.subject(input.lessonTitle),
    preview: m.body(input.lessonTitle, input.schoolName, when),
    heading: m.heading,
    paragraphs: [m.body(input.lessonTitle, input.schoolName, when)],
    ctaUrl: input.ctaUrl
  })
}

// Promotion is series- or session-scoped, so it carries no single occurrence time
// (a series has many) — the CTA takes the student to their schedule for detail.
export function renderWaitlistPromotedEmail(input: { locale: EmailLocale, schoolName: string, lessonTitle: string, ctaUrl: string }): RenderedEmail {
  const m = MESSAGES[input.locale].lesson.promoted
  return buildLessonEmail(input.locale, {
    subject: m.subject(input.lessonTitle),
    preview: m.body(input.lessonTitle, input.schoolName),
    heading: m.heading,
    paragraphs: [m.body(input.lessonTitle, input.schoolName)],
    ctaUrl: input.ctaUrl
  })
}

function formatEmailMoney(locale: EmailLocale, amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(locale === 'pl' ? 'pl-PL' : 'en-GB', { style: 'currency', currency }).format(amountMinor / 100)
}

export interface PaymentLinkEmailInput {
  locale: EmailLocale
  schoolName: string
  studentName: string
  groupTitle: string
  amountMinor: number
  currency: string
  checkoutUrl: string
}

// The hosted-Checkout link a school sends the payer (guardian, or an adult student)
// to set up the monthly subscription for a group spot. Every interpolated value is
// escaped in the HTML body (names/title are user-controlled).
export function renderPaymentLinkEmail(input: PaymentLinkEmailInput): RenderedEmail {
  const m = MESSAGES[input.locale].payment
  const footer = MESSAGES[input.locale].footer
  const paragraphs = [
    m.intro(input.studentName, input.groupTitle, input.schoolName),
    m.amount(formatEmailMoney(input.locale, input.amountMinor, input.currency)),
    m.note
  ]

  return {
    subject: m.subject(input.groupTitle),
    html: renderShell({
      locale: input.locale,
      subject: m.subject(input.groupTitle),
      preview: m.preview(input.groupTitle),
      heading: m.heading,
      bodyParagraphs: paragraphs.map(escapeHtml),
      ctaLabel: m.cta,
      ctaUrl: input.checkoutUrl,
      linkFallback: m.linkFallback,
      footnote: footer
    }),
    text: renderText({ heading: m.heading, bodyParagraphs: paragraphs, ctaLabel: m.cta, ctaUrl: input.checkoutUrl, footnote: footer })
  }
}

export interface PaymentFailedEmailInput {
  locale: EmailLocale
  schoolName: string
  studentName: string
  groupTitle: string
  ctaUrl: string
}

// Staff-facing alert that a student's monthly payment failed. The payer gets
// Stripe's own dunning email; this just keeps the school in the loop.
export function renderPaymentFailedEmail(input: PaymentFailedEmailInput): RenderedEmail {
  const m = MESSAGES[input.locale].paymentFailed
  const footer = MESSAGES[input.locale].footer
  const paragraphs = [m.intro(input.studentName, input.groupTitle, input.schoolName), m.note]

  return {
    subject: m.subject(input.studentName),
    html: renderShell({
      locale: input.locale,
      subject: m.subject(input.studentName),
      preview: m.preview(input.studentName),
      heading: m.heading,
      bodyParagraphs: paragraphs.map(escapeHtml),
      ctaLabel: m.cta,
      ctaUrl: input.ctaUrl,
      linkFallback: m.linkFallback,
      footnote: footer
    }),
    text: renderText({ heading: m.heading, bodyParagraphs: paragraphs, ctaLabel: m.cta, ctaUrl: input.ctaUrl, footnote: footer })
  }
}
