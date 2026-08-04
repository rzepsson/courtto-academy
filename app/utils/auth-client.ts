import { createAuthClient } from 'better-auth/vue'
import { organizationClient } from 'better-auth/client/plugins'
import { stripeClient } from '@better-auth/stripe/client'
import { ac, roles } from '~~/shared/permissions'

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles }),
    // Adds authClient.subscription.* (upgrade → Stripe Checkout, billingPortal →
    // Customer Portal). Subscriptions are org-scoped: callers pass referenceId =
    // active org id + customerType 'organization'.
    stripeClient({ subscription: true })
  ]
})
