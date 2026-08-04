import Stripe from 'stripe'
import { stripe as stripePlugin } from '@better-auth/stripe'
import { env } from 'node:process'
import { BILLING_PLANS } from '../../shared/billing'
import { isOrgOwner } from './services/membership'

// Stripe plugin configuration for Better Auth. Reachable from the `auth` CLI
// (auth.ts imports it), so explicit imports only — no Nuxt aliases/auto-imports.
// Mirrors mailer.ts/storage.ts: env via node:process, no useRuntimeConfig, no
// factories (rule 2). The Better Auth `subscription` table it declares is emitted
// into the generated schema by `pnpm auth:generate`.

const secretKey = env.STRIPE_SECRET_KEY

// A non-empty placeholder keeps the Stripe constructor from throwing when the key
// is unset (dev + `auth:generate` never open a socket), so the plugin — and thus
// the generated `subscription` table — is present regardless of env. The schema
// must never depend on deployment config (rule 3).
const stripeClient = new Stripe(secretKey || 'sk_test_unconfigured_placeholder')

function priceIdFor(planId: string): string {
  return env[`STRIPE_PRICE_${planId.toUpperCase()}`] ?? ''
}

// Whether real billing can happen: the secret key AND every plan's price id are
// set. Unset → the app still runs on the app-managed trial (shared/billing) and
// the pricing UI degrades to a "billing not configured" notice (like storage's
// 503) — never a broken subscribe button.
export function isBillingConfigured(): boolean {
  return Boolean(secretKey) && BILLING_PLANS.every(p => priceIdFor(p.id) !== '')
}

// NO Stripe `freeTrial` on the plans: the trial is app-managed from org creation
// (shared/billing), so a Stripe-side trial would double-dip it. Subscribing charges
// the plan price immediately.
export const stripe = stripePlugin({
  stripeClient,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  // Customers are created lazily at first checkout (referenceId = org id), so a
  // signup never triggers a Stripe network call.
  createCustomerOnSignUp: false,
  subscription: {
    enabled: true,
    plans: BILLING_PLANS.map(plan => ({ name: plan.id, priceId: priceIdFor(plan.id) })),
    // Billing is owner-only (like ownership transfer): verify the caller owns the
    // org whose subscription (referenceId) they act on, so an admin can never move
    // money on the school's behalf and no one can touch another org's billing.
    authorizeReference: async ({ user, referenceId }) => isOrgOwner(referenceId, user.id)
  }
})
