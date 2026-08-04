import type { PlanId } from '~~/shared/billing'

// Subscription actions for the active org, shared by /school/billing and the
// /billing-required gate. Wraps the Better Auth Stripe client: `upgrade` opens
// Stripe Checkout for a plan, `openPortal` opens the Customer Portal (where cancel
// / card update / invoices live, so the app never needs those flows itself). Both
// redirect the browser to a Stripe-hosted URL. Owner-only in practice — the plugin's
// authorizeReference re-checks ownership server-side, so the UI gating is just UX.
export function useBilling() {
  const { toastError } = useApiError()
  const { data: context } = useAppContext()

  // The plan id currently being processed, or 'portal' — drives per-button spinners.
  const pending = ref<PlanId | 'portal' | null>(null)

  function referenceId(): string | null {
    return activeMembershipOf(context.value)?.organization.id ?? null
  }

  async function upgrade(plan: PlanId, successUrl = '/school/billing') {
    const organizationId = referenceId()
    if (!organizationId || pending.value) {
      return
    }
    pending.value = plan
    try {
      const { data, error } = await authClient.subscription.upgrade({
        plan,
        referenceId: organizationId,
        successUrl,
        cancelUrl: '/school/billing'
      })
      if (error) {
        toastError('billing.errors.checkoutFailed', error)
        pending.value = null
        return
      }
      if (data?.url) {
        await navigateTo(data.url, { external: true })
        return
      }
      pending.value = null
    } catch (error) {
      toastError('billing.errors.checkoutFailed', error)
      pending.value = null
    }
  }

  async function openPortal(returnUrl = '/school/billing') {
    const organizationId = referenceId()
    if (!organizationId || pending.value) {
      return
    }
    pending.value = 'portal'
    try {
      const { data, error } = await authClient.subscription.billingPortal({
        referenceId: organizationId,
        returnUrl
      })
      if (error) {
        toastError('billing.errors.portalFailed', error)
        pending.value = null
        return
      }
      if (data?.url) {
        await navigateTo(data.url, { external: true })
        return
      }
      pending.value = null
    } catch (error) {
      toastError('billing.errors.portalFailed', error)
      pending.value = null
    }
  }

  return { pending, upgrade, openPortal }
}
