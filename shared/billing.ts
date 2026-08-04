// Billing domain — CORE, product-neutral SaaS-subscription logic. The school
// (organization) is the paying tenant; a subscription is scoped to an org via the
// Better Auth Stripe plugin's `referenceId`. Pure (no Nuxt/Node imports) so it
// loads everywhere: the client (pricing UI + entitlement for routing), the server
// service, and the `auth` CLI (which reads the plan catalog to build the plugin
// config).
//
// Trial is APP-MANAGED, not Stripe-managed: a fresh school is fully usable for
// TRIAL_DAYS from its creation with no card and no Stripe object at all. Stripe
// only enters the picture when they subscribe — which is why the plans carry NO
// Stripe `freeTrial` (that would grant a second trial on top of this one). When
// the window elapses without an active subscription, the whole org is gated (see
// resolveEntitlement + the /billing-required routing).

const DAY_MS = 24 * 60 * 60 * 1000

export const TRIAL_DAYS = 14

export const PLAN_IDS = ['starter', 'pro'] as const
export type PlanId = (typeof PLAN_IDS)[number]

export function isPlanId(value: string | null | undefined): value is PlanId {
  return value != null && (PLAN_IDS as readonly string[]).includes(value)
}

// Display catalog — what the pricing UI renders. Deliberately NOT the Stripe price
// IDs: those are deployment config, read from env server-side (see server billing
// config), so keeping this pure lets the client import it without leaking price
// config. `monthlyPrice` is minor units (grosze) for DISPLAY only — Stripe stays
// the billing source of truth; `featureKeys` are i18n keys the page localizes
// (rule 5); `highlighted` marks the recommended tier.
export interface PlanCatalogEntry {
  id: PlanId
  monthlyPrice: number
  currency: string
  highlighted: boolean
  featureKeys: readonly string[]
}

export const BILLING_PLANS: readonly PlanCatalogEntry[] = [
  {
    id: 'starter',
    monthlyPrice: 9900,
    currency: 'PLN',
    highlighted: false,
    featureKeys: ['members', 'schedule', 'courts', 'email']
  },
  {
    id: 'pro',
    monthlyPrice: 24900,
    currency: 'PLN',
    highlighted: true,
    featureKeys: ['everythingStarter', 'analytics', 'auditLog', 'prioritySupport']
  }
] as const

export function planById(id: string | null | undefined): PlanCatalogEntry | null {
  return isPlanId(id) ? BILLING_PLANS.find(p => p.id === id) ?? null : null
}

// ─── Entitlement ─────────────────────────────────────────────────────────────

// Our normalized subscription state — what the app asks about, decoupled from
// Stripe's raw status vocabulary. `trialing`/`active` grant access; the rest block
// but stay distinct so the gate can say the right thing (a fixable payment problem
// vs. a clean cancellation vs. a never-subscribed trial that simply ran out).
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'none'

// Raw Stripe statuses we treat as granting access. Anything else blocks — fail
// SAFE, never entitle an unknown state (mirrors consentState degrading to
// 'unknown' rather than 'granted').
const ENTITLED_STRIPE_STATUSES = new Set(['active', 'trialing'])
// A payment problem is recoverable (update the card) — kept distinct from a clean
// cancellation so /billing-required can point the owner at the portal, not checkout.
const PAYMENT_PROBLEM_STATUSES = new Set(['past_due', 'unpaid', 'incomplete'])

// The minimal slice of the Better Auth `subscription` row the domain needs. The
// service maps the DB row to this so shared/ never imports a DB type.
export interface SubscriptionSnapshot {
  plan: string
  status: string
  periodEnd: Date | null
  trialEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface Entitlement {
  status: SubscriptionStatus
  entitled: boolean
  planId: PlanId | null
  // Set only while on the APP-managed trial (no subscription yet): when the trial
  // ends + whole days remaining (ceil, never negative). Both null once subscribed.
  trialEndsAt: Date | null
  trialDaysLeft: number | null
}

function trialDaysLeft(now: Date, trialEnd: Date): number {
  return Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / DAY_MS))
}

// The single source of truth for "may this school operate?". Given the org's
// subscription (null when it has never subscribed) and when the org was created,
// resolves the normalized state + whether access is granted.
export function resolveEntitlement(
  subscription: SubscriptionSnapshot | null,
  orgCreatedAt: Date,
  now: Date = new Date()
): Entitlement {
  if (subscription) {
    const planId = isPlanId(subscription.plan) ? subscription.plan : null

    if (ENTITLED_STRIPE_STATUSES.has(subscription.status)) {
      // Trust Stripe's status, but if the relevant period clearly ended and a
      // webhook was missed, stop granting access (defensive — never keep a lapsed
      // school running because an event was dropped).
      const boundary = subscription.status === 'trialing' ? subscription.trialEnd : subscription.periodEnd
      if (!boundary || boundary.getTime() > now.getTime()) {
        return {
          status: subscription.status === 'trialing' ? 'trialing' : 'active',
          entitled: true,
          planId,
          trialEndsAt: null,
          trialDaysLeft: null
        }
      }
    }

    return {
      status: PAYMENT_PROBLEM_STATUSES.has(subscription.status) ? 'past_due' : 'canceled',
      entitled: false,
      planId,
      trialEndsAt: null,
      trialDaysLeft: null
    }
  }

  // No subscription — the app-managed trial window from org creation.
  const trialEnd = new Date(orgCreatedAt.getTime() + TRIAL_DAYS * DAY_MS)
  if (trialEnd.getTime() > now.getTime()) {
    return {
      status: 'trialing',
      entitled: true,
      planId: null,
      trialEndsAt: trialEnd,
      trialDaysLeft: trialDaysLeft(now, trialEnd)
    }
  }

  return { status: 'none', entitled: false, planId: null, trialEndsAt: null, trialDaysLeft: 0 }
}
