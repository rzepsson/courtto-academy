import { env } from 'node:process'
import { createTransport, type Transporter } from 'nodemailer'

// The transport seam for all outbound mail. Speaks plain SMTP via nodemailer, so
// the provider behind it is swappable by env alone — Brevo's SMTP relay today,
// AWS SES (eu-central-1) tomorrow, Mailpit in dev — and nothing outside this file
// knows which. Mirrors server/utils/storage.ts: a module-level lazy singleton,
// env read via node:process, no useRuntimeConfig and no factories (rule 2).
// Explicit imports only — this module is reachable from server/utils/auth.ts,
// which the `auth` CLI loads outside Nuxt.
//
//   SMTP_HOST        e.g. smtp-relay.brevo.com (dev: localhost for Mailpit)
//   SMTP_PORT        default 587 (STARTTLS); 465 with SMTP_SECURE=true
//   SMTP_USER        SMTP login (optional — Mailpit needs none)
//   SMTP_PASSWORD    SMTP password / API key (optional)
//   SMTP_SECURE      'true' to connect over TLS immediately (port 465)
//   MAIL_FROM        From header, e.g. "Courtto Academy <no-reply@courtto.app>"
//
// Unset SMTP_HOST/MAIL_FROM -> the loud console transport below. Unlike storage's
// silent 503, mail must never quietly no-op: a reset you don't notice is broken
// is worse than a visible one, so the fallback prints the whole message (link and
// all) to the server log so the flow is still completable in dev.

export interface OutgoingMail {
  to: string
  subject: string
  html: string
  text: string
}

export interface MailTransport {
  readonly name: string
  send(mail: OutgoingMail): Promise<void>
}

interface SmtpConfig {
  host: string
  port: number
  user: string | undefined
  pass: string | undefined
  secure: boolean
  from: string
}

function readConfig(): SmtpConfig | null {
  const host = env.SMTP_HOST
  const from = env.MAIL_FROM

  if (!host || !from) {
    return null
  }

  return {
    host,
    port: Number(env.SMTP_PORT) || 587,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASSWORD || undefined,
    secure: env.SMTP_SECURE === 'true',
    from
  }
}

class SmtpTransport implements MailTransport {
  readonly name = 'smtp'
  private transporter: Transporter
  private from: string

  constructor(config: SmtpConfig) {
    this.from = config.from
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined
    })
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    })
  }
}

const RULE = '━'.repeat(64)

// Loud on purpose: an un-configured provider must be impossible to miss, and the
// printed text body carries the reset/invite link so the dev can finish the flow.
class ConsoleTransport implements MailTransport {
  readonly name = 'console'

  async send(mail: OutgoingMail): Promise<void> {
    console.warn(
      `\n${RULE}\n`
      + '  ✉  EMAIL NOT SENT — no SMTP provider configured\n'
      + '     Set SMTP_HOST + MAIL_FROM to deliver mail (see .env.example).\n'
      + `     To:      ${mail.to}\n`
      + `     Subject: ${mail.subject}\n`
      + '  ── text body ──\n'
      + `${mail.text}\n`
      + `${RULE}\n`
    )
  }
}

let smtpTransport: SmtpTransport | null = null
let override: MailTransport | null = null

function resolveTransport(): MailTransport {
  // Test injection wins — the server suite records what would have been sent
  // instead of touching the network.
  if (override) return override

  const config = readConfig()
  if (!config) return new ConsoleTransport()

  if (!smtpTransport) {
    smtpTransport = new SmtpTransport(config)
  }
  return smtpTransport
}

export function isMailerConfigured(): boolean {
  return readConfig() !== null
}

// The single public entry point. Domain services (services/email.ts) render the
// localized content and hand a ready message here; this file never knows what an
// email is *about*.
export async function sendMail(mail: OutgoingMail): Promise<void> {
  await resolveTransport().send(mail)
}

// Test seam: inject a recording transport, assert on what it captured, then clear.
export function setMailTransport(transport: MailTransport): void {
  override = transport
}

export function clearMailTransport(): void {
  override = null
}
