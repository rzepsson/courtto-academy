import Stripe from 'stripe'
import { env } from 'node:process'

// CORE payments plumbing — the Stripe client for the PLATFORM's Connect operations
// (creating connected accounts, and later direct charges on a school's behalf with
// an application fee). Mirrors billing-config.ts / mailer.ts: env via node:process,
// a module-level lazy singleton, no useRuntimeConfig, no factories (rule 2).
//
// This is the RAW Stripe SDK, not the Better Auth Stripe plugin: Connect (accounts,
// account links, direct charges + application_fee) is outside the plugin's
// subscription scope. It uses the SAME platform secret key as the subscription
// billing (one Stripe platform account); a separate client instance keeps this a
// self-contained concern that moves with the core.

const secretKey = env.STRIPE_SECRET_KEY

let realClient: Stripe | null = null
// Test seam (mirrors the mailer's setMailTransport): server tests inject a fake so
// nothing ever reaches Stripe.
let override: Stripe | null = null

function realStripe(): Stripe {
  if (!realClient) {
    // A non-empty placeholder keeps the constructor from throwing when unset — dev
    // and tests never open a socket to Stripe.
    realClient = new Stripe(secretKey || 'sk_test_unconfigured_placeholder')
  }
  return realClient
}

export function paymentsStripe(): Stripe {
  return override ?? realStripe()
}

// Whether payment collection can happen at all: the platform secret key is set.
// Unset → onboarding/collection are unavailable and the UI degrades to a notice
// (like storage's 503), never a broken button.
export function isPaymentsConfigured(): boolean {
  return Boolean(secretKey)
}

// The Connect webhook's signing secret. Separate from the subscription plugin's
// webhook — Connect events arrive on their own endpoint. Empty when unset (the
// webhook handler then refuses to process, never trusts an unsigned event).
export function connectWebhookSecret(): string {
  return env.STRIPE_CONNECT_WEBHOOK_SECRET || ''
}

// Courtto's platform commission on lesson fees, as a percent (0–100). Default 0 —
// the mechanism is wired (application_fee_percent on every subscription) but takes
// nothing until the platform sets this. Clamped to a sane range so a typo can't
// charge a school 900%.
export function platformFeePercent(): number {
  const raw = Number(env.PLATFORM_FEE_PERCENT ?? '0')
  if (!Number.isFinite(raw) || raw < 0) {
    return 0
  }
  return Math.min(raw, 100)
}

// ── Test seam ──
export function setPaymentsStripe(client: Stripe | null): void {
  override = client
}

export function clearPaymentsStripe(): void {
  override = null
}
