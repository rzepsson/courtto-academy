<script setup lang="ts">
import { planById } from '~~/shared/billing'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const toast = useToast()
const route = useRoute()
const { data: context } = await useAppContext()
const { pending: actionPending, openPortal } = useBilling()

const active = computed(() => activeMembershipOf(context.value))
const canManage = computed(() => active.value?.role === 'owner')

const { data, status, refresh } = await useLazyFetch('/api/school/billing')

const entitlement = computed(() => data.value?.entitlement ?? null)
const subscription = computed(() => data.value?.subscription ?? null)
const configured = computed(() => data.value?.configured ?? false)
const currentPlan = computed(() => planById(subscription.value?.plan ?? entitlement.value?.planId ?? null))
const currentPlanId = computed(() => currentPlan.value?.id ?? null)

// Returning from Stripe Checkout: the webhook may land a moment after the
// redirect, so pull fresh billing + entitlement (the latter gates routing).
onMounted(async () => {
  if (route.query.checkout === 'success') {
    toast.add({ title: t('billing.checkoutSuccess'), color: 'success' })
    await Promise.all([refresh(), refreshAppContext()])
  }
})
</script>

<template>
  <UDashboardPanel id="school-billing">
    <template #header>
      <UDashboardNavbar :title="t('billing.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="status === 'pending'"
        class="flex flex-col gap-6"
      >
        <USkeleton class="h-24 w-full" />
        <div class="grid gap-4 sm:grid-cols-2">
          <USkeleton class="h-64 w-full" />
          <USkeleton class="h-64 w-full" />
        </div>
      </div>

      <div
        v-else
        class="flex flex-col gap-8"
      >
        <MotionReveal>
          <h1 class="text-2xl font-semibold text-highlighted">
            {{ t('billing.title') }}
          </h1>
          <p class="mt-1 text-muted">
            {{ t('billing.subtitle') }}
          </p>
        </MotionReveal>

        <MotionReveal :delay="0.06">
          <UAlert
            v-if="!configured"
            icon="i-lucide-info"
            color="neutral"
            variant="subtle"
            :title="t('billing.notConfigured.title')"
            :description="t('billing.notConfigured.description')"
          />

          <UCard
            v-else
            variant="subtle"
          >
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="flex items-start gap-3">
                <UIcon
                  :name="entitlement?.status === 'past_due' ? 'i-lucide-triangle-alert' : 'i-lucide-badge-check'"
                  class="mt-0.5 size-6 shrink-0"
                  :class="entitlement?.status === 'past_due' ? 'text-warning' : 'text-primary'"
                />
                <div>
                  <p class="font-semibold text-highlighted">
                    <template v-if="currentPlan">
                      {{ t(`billing.plans.${currentPlan.id}.name`) }}
                    </template>
                    <template v-else>
                      {{ t('billing.trial.title') }}
                    </template>
                  </p>
                  <p class="mt-0.5 text-sm text-muted">
                    <template v-if="entitlement?.status === 'trialing' && !currentPlan">
                      {{ t('billing.trial.daysLeft', { days: entitlement?.trialDaysLeft ?? 0 }) }}
                    </template>
                    <template v-else-if="entitlement?.status === 'past_due'">
                      {{ t('billing.status.pastDue') }}
                    </template>
                    <template v-else-if="subscription?.cancelAtPeriodEnd && subscription?.periodEnd">
                      {{ t('billing.status.cancelsOn', { date: formatDate(subscription.periodEnd, locale, 'long') }) }}
                    </template>
                    <template v-else-if="subscription?.periodEnd">
                      {{ t('billing.status.renewsOn', { date: formatDate(subscription.periodEnd, locale, 'long') }) }}
                    </template>
                  </p>
                </div>
              </div>

              <UButton
                v-if="subscription && canManage"
                color="neutral"
                variant="subtle"
                icon="i-lucide-external-link"
                :loading="actionPending === 'portal'"
                :label="t('billing.manage')"
                @click="openPortal()"
              />
            </div>
          </UCard>
        </MotionReveal>

        <MotionReveal
          v-if="configured"
          :delay="0.12"
          class="flex flex-col gap-4"
        >
          <h2 class="text-sm font-medium uppercase tracking-wide text-muted">
            {{ currentPlanId ? t('billing.changePlan') : t('billing.choosePlanHeading') }}
          </h2>
          <BillingPlanPicker
            :current-plan-id="currentPlanId"
            :configured="configured"
            :can-manage="canManage"
          />
          <p
            v-if="!canManage"
            class="text-sm text-muted"
          >
            {{ t('billing.ownerOnly') }}
          </p>
        </MotionReveal>
      </div>
    </template>
  </UDashboardPanel>
</template>
