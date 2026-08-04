import { randomUUID } from 'node:crypto'
import type StripeNS from 'stripe'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { orgPaymentAccount, pricingPlan } from '../../database/app-schema'
import type { PricingPlanDto } from '../../database/types'
import { pricingPlanCreateSchema, pricingPlanPatchSchema } from '../../../shared/pricing-plan-schema'
import { REGIONAL_FALLBACK } from '../../../shared/regional'
import { paymentsStripe } from '../payments-config'
import { captureError } from '../monitoring'
import { getOrgProfile } from './orgProfile'

// Pricing-plan service — ACADEMY (it prices lessons), app-owned (Drizzle writes
// directly). Each plan is mirrored as a Stripe Product + recurring Price ON THE
// SCHOOL'S CONNECTED ACCOUNT (direct charges → the school is the merchant), so every
// Stripe call carries the `{ stripeAccount }` option. Field rules live in the shared
// Zod schema (the same one the form binds to). Every query is scoped by
// organizationId — never id alone — for tenant isolation (server-tested).

const PLAN_COLUMNS = {
  id: pricingPlan.id,
  name: pricingPlan.name,
  description: pricingPlan.description,
  amountMinor: pricingPlan.amountMinor,
  currency: pricingPlan.currency,
  archivedAt: pricingPlan.archivedAt,
  createdAt: pricingPlan.createdAt
}

const createSchema = pricingPlanCreateSchema(code => code)
const patchSchema = pricingPlanPatchSchema(code => code)

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

// A Stripe API failure during plan config → a clean coded error (never a raw 500),
// captured for observability. Config-time, not money movement, so surfacing it as a
// retryable "something went wrong" is right.
function stripeFailed(error: unknown, organizationId: string, op: string): never {
  captureError(error, { scope: `payments.pricingPlan.${op}`, organizationId })
  throw createError({ statusCode: 502, statusMessage: 'Stripe request failed', data: { code: 'PAYMENTS_STRIPE_ERROR' } })
}

// The school's connected-account id — required to create catalog objects on it.
// Null-account → a coded error the UI turns into "set up payments first".
async function requireConnectedAccountId(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ stripeAccountId: orgPaymentAccount.stripeAccountId })
    .from(orgPaymentAccount)
    .where(eq(orgPaymentAccount.organizationId, organizationId))
    .limit(1)
  if (!row?.stripeAccountId) {
    bad('Connect a payment account first', 'PAYMENTS_ACCOUNT_REQUIRED')
  }
  return row!.stripeAccountId
}

async function getPlanRow(organizationId: string, planId: string) {
  const [row] = await db
    .select()
    .from(pricingPlan)
    .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, planId)))
    .limit(1)
  return row ?? null
}

export async function listPricingPlans(
  organizationId: string,
  options: { includeArchived?: boolean } = {}
): Promise<PricingPlanDto[]> {
  const where = options.includeArchived
    ? eq(pricingPlan.organizationId, organizationId)
    : and(eq(pricingPlan.organizationId, organizationId), isNull(pricingPlan.archivedAt))

  return db.select(PLAN_COLUMNS).from(pricingPlan).where(where).orderBy(asc(pricingPlan.createdAt))
}

function toDto(row: typeof pricingPlan.$inferSelect): PricingPlanDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    amountMinor: row.amountMinor,
    currency: row.currency,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt
  }
}

export async function createPricingPlan(
  organizationId: string,
  body: unknown,
  userId: string
): Promise<PricingPlanDto> {
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid pricing plan', 'INVALID_PRICING_PLAN')
  }
  const values = parsed.data

  const accountId = await requireConnectedAccountId(organizationId)
  const profile = await getOrgProfile(organizationId)
  const currency = (profile.currency || REGIONAL_FALLBACK.currency).toUpperCase()

  const planId = randomUUID()
  const stripe = paymentsStripe()
  const options = { stripeAccount: accountId }

  // Create the Stripe Product + recurring Price on the connected account. Idempotency
  // keys (derived from the plan id) mean a same-day retry reuses the same objects
  // instead of creating duplicates.
  let product: StripeNS.Product
  try {
    product = await stripe.products.create(
      { name: values.name, ...(values.description ? { description: values.description } : {}) },
      { ...options, idempotencyKey: `plan-product-${planId}` }
    )
  } catch (error) {
    stripeFailed(error, organizationId, 'create.product')
  }

  let price: StripeNS.Price
  try {
    price = await stripe.prices.create(
      {
        product: product.id,
        unit_amount: values.amountMinor,
        currency: currency.toLowerCase(),
        recurring: { interval: 'month' }
      },
      { ...options, idempotencyKey: `plan-price-${planId}` }
    )
  } catch (error) {
    // Don't leave an orphan active product behind if the price failed.
    await stripe.products.update(product.id, { active: false }, options).catch(() => {})
    stripeFailed(error, organizationId, 'create.price')
  }

  const [created] = await db
    .insert(pricingPlan)
    .values({
      id: planId,
      organizationId,
      name: values.name,
      description: values.description,
      amountMinor: values.amountMinor,
      currency,
      stripeProductId: product.id,
      stripePriceId: price.id,
      createdBy: userId
    })
    .returning()

  return toDto(created!)
}

export async function updatePricingPlan(
  organizationId: string,
  planId: string,
  body: unknown
): Promise<PricingPlanDto | null> {
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid pricing plan', 'INVALID_PRICING_PLAN')
  }
  const values = parsed.data

  const plan = await getPlanRow(organizationId, planId)
  if (!plan) {
    return null
  }
  if (plan.archivedAt) {
    bad('Restore the plan before editing it', 'PRICING_PLAN_ARCHIVED')
  }

  const accountId = await requireConnectedAccountId(organizationId)
  const stripe = paymentsStripe()
  const options = { stripeAccount: accountId }

  const update: Partial<typeof pricingPlan.$inferSelect> = {}

  // Name/description → mutate the Stripe Product in place (its name is what shows on
  // the parent's invoice).
  if ((values.name !== undefined && values.name !== plan.name)
    || (values.description !== undefined && values.description !== plan.description)) {
    const productUpdate: StripeNS.ProductUpdateParams = {}
    if (values.name !== undefined) productUpdate.name = values.name
    if (values.description) productUpdate.description = values.description
    if (plan.stripeProductId) {
      try {
        await stripe.products.update(plan.stripeProductId, productUpdate, options)
      } catch (error) {
        stripeFailed(error, organizationId, 'update.product')
      }
    }
    if (values.name !== undefined) update.name = values.name
    if (values.description !== undefined) update.description = values.description
  }

  // Amount change → a Stripe Price is IMMUTABLE, so create a new one and deactivate
  // the old. Existing subscriptions keep the old price (grandfathered — the locked
  // policy); only new subscriptions use the new price.
  if (values.amountMinor !== undefined && values.amountMinor !== plan.amountMinor && plan.stripeProductId) {
    let price: StripeNS.Price
    try {
      price = await stripe.prices.create(
        {
          product: plan.stripeProductId,
          unit_amount: values.amountMinor,
          currency: plan.currency.toLowerCase(),
          recurring: { interval: 'month' }
        },
        { ...options, idempotencyKey: `plan-price-${planId}-${values.amountMinor}` }
      )
      if (plan.stripePriceId) {
        await stripe.prices.update(plan.stripePriceId, { active: false }, options)
      }
    } catch (error) {
      stripeFailed(error, organizationId, 'update.price')
    }
    update.stripePriceId = price.id
    update.amountMinor = values.amountMinor
  }

  if (Object.keys(update).length === 0) {
    return toDto(plan)
  }

  const [updated] = await db
    .update(pricingPlan)
    .set(update)
    .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, planId)))
    .returning()

  return updated ? toDto(updated) : null
}

// Archive: soft-delete. Deactivates the Stripe Product + Price (hidden from new use)
// but existing subscriptions continue — Stripe keeps a subscription on an inactive
// price. Reversible via restore.
export async function archivePricingPlan(organizationId: string, planId: string): Promise<PricingPlanDto | null> {
  const plan = await getPlanRow(organizationId, planId)
  if (!plan) {
    return null
  }
  if (plan.archivedAt) {
    return toDto(plan)
  }

  const accountId = await requireConnectedAccountId(organizationId)
  const options = { stripeAccount: accountId }
  const stripe = paymentsStripe()
  try {
    if (plan.stripePriceId) await stripe.prices.update(plan.stripePriceId, { active: false }, options)
    if (plan.stripeProductId) await stripe.products.update(plan.stripeProductId, { active: false }, options)
  } catch (error) {
    stripeFailed(error, organizationId, 'archive')
  }

  const [updated] = await db
    .update(pricingPlan)
    .set({ archivedAt: new Date() })
    .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, planId)))
    .returning()

  return updated ? toDto(updated) : null
}

export async function restorePricingPlan(organizationId: string, planId: string): Promise<PricingPlanDto | null> {
  const plan = await getPlanRow(organizationId, planId)
  if (!plan) {
    return null
  }
  if (!plan.archivedAt) {
    return toDto(plan)
  }

  const accountId = await requireConnectedAccountId(organizationId)
  const options = { stripeAccount: accountId }
  const stripe = paymentsStripe()
  try {
    if (plan.stripeProductId) await stripe.products.update(plan.stripeProductId, { active: true }, options)
    if (plan.stripePriceId) await stripe.prices.update(plan.stripePriceId, { active: true }, options)
  } catch (error) {
    stripeFailed(error, organizationId, 'restore')
  }

  const [updated] = await db
    .update(pricingPlan)
    .set({ archivedAt: null })
    .where(and(eq(pricingPlan.organizationId, organizationId), eq(pricingPlan.id, planId)))
    .returning()

  return updated ? toDto(updated) : null
}
