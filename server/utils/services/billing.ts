import { eq } from 'drizzle-orm'
// Explicit imports (no Nuxt auto-imports): keeps this consistent with the other
// services and safe if it's ever pulled into an auth-CLI-reachable path.
import { db } from '../db'
import { organization, subscription } from '../../database/schema'
import { resolveEntitlement } from '../../../shared/billing'
import type { Entitlement, SubscriptionSnapshot } from '../../../shared/billing'

// Billing service — CORE, product-neutral. READ-ONLY over the Better Auth-owned
// `subscription` table (rule 4): all mutations happen through the Stripe plugin's
// client/API (checkout, portal, webhooks), never a Drizzle write here. The org is
// the paying tenant, so every read is scoped by referenceId = organizationId.

// The current subscription as the billing page displays it. Cancellation + card
// updates happen in the Stripe portal, so the client never needs the row's ids —
// just enough to render "Pro · renews 12 Aug" or "cancels at period end".
export interface OrgSubscriptionSummary {
  plan: string
  status: string
  periodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

// An org can accumulate more than one subscription row over time (e.g. resubscribe
// after a cancel). Pick the one that decides access: prefer any currently-entitled
// row; otherwise the most recent by period end, so a blocked school reports its
// latest state (past_due vs canceled), not an ancient one. null = no rows at all
// (→ the app-managed trial branch in resolveEntitlement).
function pickRepresentative(rows: SubscriptionSnapshot[], now: Date): SubscriptionSnapshot | null {
  if (rows.length === 0) {
    return null
  }
  const entitled = rows.find(row => resolveEntitlement(row, now, now).entitled)
  if (entitled) {
    return entitled
  }
  return [...rows].sort((a, b) => (b.periodEnd?.getTime() ?? 0) - (a.periodEnd?.getTime() ?? 0))[0] ?? null
}

async function loadOrgBilling(
  organizationId: string,
  now: Date
): Promise<{ entitlement: Entitlement, representative: SubscriptionSnapshot | null }> {
  const [org] = await db
    .select({ createdAt: organization.createdAt })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  // Unknown org — fail safe (not entitled) without throwing; the caller's own
  // membership guard already gates who reaches here.
  if (!org) {
    return { entitlement: resolveEntitlement(null, new Date(0), now), representative: null }
  }

  const rows = await db
    .select({
      plan: subscription.plan,
      status: subscription.status,
      periodEnd: subscription.periodEnd,
      trialEnd: subscription.trialEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
    })
    .from(subscription)
    .where(eq(subscription.referenceId, organizationId))

  const snapshots: SubscriptionSnapshot[] = rows.map(row => ({
    plan: row.plan,
    status: row.status,
    periodEnd: row.periodEnd,
    trialEnd: row.trialEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false
  }))

  const representative = pickRepresentative(snapshots, now)
  return { entitlement: resolveEntitlement(representative, org.createdAt, now), representative }
}

// The single question the access gate asks: may this school operate right now?
// Called on every mutating school/coach/student request (see requireActiveMembership).
export async function getOrgEntitlement(organizationId: string): Promise<Entitlement> {
  const { entitlement } = await loadOrgBilling(organizationId, new Date())
  return entitlement
}

// Everything the billing page needs in one read: the entitlement (status + trial
// days) and the representative subscription summary (null while on the app trial).
export async function getOrgBilling(
  organizationId: string
): Promise<{ entitlement: Entitlement, subscription: OrgSubscriptionSummary | null }> {
  const { entitlement, representative } = await loadOrgBilling(organizationId, new Date())
  return {
    entitlement,
    subscription: representative
      ? {
          plan: representative.plan,
          status: representative.status,
          periodEnd: representative.periodEnd,
          cancelAtPeriodEnd: representative.cancelAtPeriodEnd
        }
      : null
  }
}
