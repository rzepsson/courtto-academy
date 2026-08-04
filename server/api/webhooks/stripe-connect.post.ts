import type StripeNS from 'stripe'

// Stripe Connect webhook — the source of truth for connected-account + subscription
// state. Separate endpoint from the subscription plugin's webhook (Connect events
// arrive on their own). Public by necessity (Stripe calls it), but every request is
// authenticated by the signature: an unsigned or mis-signed body is rejected, never
// processed.
//
// Every handler is a STATE MIRROR: it retrieves the current Stripe object and writes
// its state, so a resend or out-of-order delivery converges to the truth. That makes
// all handlers idempotent by design — no event-id dedupe table is needed even for the
// money-moving events (invoice.*), because we never do incremental arithmetic here;
// Stripe holds the ledger and we mirror the current subscription status.

// The subscription id carried by a subscription/checkout/invoice event.
function subscriptionIdFromEvent(stripeEvent: StripeNS.Event): string | null {
  const object = stripeEvent.data.object as unknown as Record<string, unknown>
  if (stripeEvent.type.startsWith('customer.subscription.')) {
    return typeof object.id === 'string' ? object.id : null
  }
  // checkout.session.* and invoice.* carry `subscription` (string | object | null).
  const subscription = object.subscription
  if (typeof subscription === 'string') {
    return subscription
  }
  if (subscription && typeof subscription === 'object' && typeof (subscription as { id?: unknown }).id === 'string') {
    return (subscription as { id: string }).id
  }
  return null
}

export default defineEventHandler(async (event) => {
  const secret = connectWebhookSecret()
  if (!secret) {
    // No signing secret configured → we can't trust anything; refuse rather than
    // process an unverifiable event.
    throw createError({ statusCode: 503, statusMessage: 'Webhook not configured' })
  }

  const signature = getHeader(event, 'stripe-signature')
  const raw = await readRawBody(event)
  if (!signature || !raw) {
    throw createError({ statusCode: 400, statusMessage: 'Missing signature or body' })
  }

  let stripeEvent: StripeNS.Event
  try {
    stripeEvent = paymentsStripe().webhooks.constructEvent(raw, signature, secret)
  } catch (error) {
    captureError(error, { scope: 'payments.webhook.verify' })
    throw createError({ statusCode: 400, statusMessage: 'Invalid signature' })
  }

  try {
    // For Connect direct-charge events this is the connected account the event fired
    // on — the account we must retrieve the object against.
    const connectedAccount = stripeEvent.account

    switch (stripeEvent.type) {
      case 'account.updated': {
        const account = stripeEvent.data.object as StripeNS.Account
        await syncAccountFromStripe(account.id)
        break
      }
      case 'checkout.session.completed':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const subscriptionId = subscriptionIdFromEvent(stripeEvent)
        if (connectedAccount && subscriptionId) {
          await syncEnrollmentSubscription(connectedAccount, subscriptionId)
        }
        break
      }
      // Refund / dispute events land in a later phase.
    }
  } catch (error) {
    // Never 500 back to Stripe for a processing hiccup on an event we've already
    // verified — that would trigger endless retries. Capture it and ack.
    captureError(error, { scope: 'payments.webhook.process', path: stripeEvent.type })
  }

  return { received: true }
})
