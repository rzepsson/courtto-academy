<script setup lang="ts">
import type { PaymentAccountDto } from '~~/server/database/types'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t } = useI18n()
const route = useRoute()
const { toastError } = useApiError()
const { data: context } = await useAppContext()

const canManage = computed(() => activeMembershipOf(context.value)?.role === 'owner')

const { data, status, refresh } = await useLazyFetch<{ account: PaymentAccountDto }>('/api/school/payments/account', {
  key: 'school:payments-account'
})
const account = computed(() => data.value?.account ?? null)
const loading = computed(() => status.value === 'pending')
const accountStatus = computed(() => account.value?.status ?? 'none')

const starting = ref(false)
async function startOnboarding() {
  if (starting.value) {
    return
  }
  starting.value = true
  try {
    const { url } = await $fetch<{ url: string }>('/api/school/payments/connect', { method: 'POST' })
    await navigateTo(url, { external: true })
  } catch (error) {
    toastError('payments.errors.onboardingFailed', error)
    starting.value = false
  }
}

// Returning from Stripe onboarding (?onboarding=return|refresh): the GET already
// live-syncs the mirror, so just refetch to reflect the new state.
onMounted(() => {
  if (route.query.onboarding) {
    refresh()
  }
})
</script>

<template>
  <UDashboardPanel id="school-payments">
    <template #header>
      <UDashboardNavbar :title="t('payments.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <MotionReveal>
          <h1 class="text-2xl font-semibold text-highlighted">
            {{ t('payments.title') }}
          </h1>
          <p class="mt-1 max-w-2xl text-muted">
            {{ t('payments.subtitle') }}
          </p>
        </MotionReveal>

        <USkeleton
          v-if="loading"
          class="h-52 w-full"
        />

        <MotionReveal
          v-else
          :delay="0.06"
        >
          <!-- Platform not configured -->
          <UAlert
            v-if="!account?.configured"
            icon="i-lucide-info"
            color="neutral"
            variant="subtle"
            :title="t('payments.notConfigured.title')"
            :description="t('payments.notConfigured.description')"
          />

          <!-- Not started -->
          <UCard
            v-else-if="accountStatus === 'none'"
            variant="subtle"
          >
            <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <UIcon
                  name="i-lucide-hand-coins"
                  class="size-6 text-primary"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-highlighted">
                  {{ t('payments.none.title') }}
                </p>
                <p class="mt-1 text-sm text-muted">
                  {{ t('payments.none.description') }}
                </p>
              </div>
              <UButton
                v-if="canManage"
                color="primary"
                icon="i-lucide-external-link"
                :loading="starting"
                :label="t('payments.none.action')"
                @click="startOnboarding()"
              />
              <p
                v-else
                class="text-sm text-muted"
              >
                {{ t('payments.ownerOnly') }}
              </p>
            </div>
          </UCard>

          <!-- Onboarding incomplete / under review -->
          <UCard
            v-else-if="accountStatus === 'pending'"
            variant="subtle"
          >
            <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/10">
                <UIcon
                  name="i-lucide-clock"
                  class="size-6 text-warning"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-highlighted">
                  {{ t('payments.pending.title') }}
                </p>
                <p class="mt-1 text-sm text-muted">
                  {{ t('payments.pending.description') }}
                </p>
              </div>
              <UButton
                v-if="canManage"
                color="neutral"
                variant="subtle"
                icon="i-lucide-external-link"
                :loading="starting"
                :label="t('payments.pending.action')"
                @click="startOnboarding()"
              />
            </div>
          </UCard>

          <!-- Ready -->
          <UCard
            v-else
            variant="subtle"
          >
            <div class="flex flex-col gap-4">
              <div class="flex items-start gap-3">
                <UIcon
                  name="i-lucide-badge-check"
                  class="mt-0.5 size-6 shrink-0 text-primary"
                />
                <div>
                  <p class="font-semibold text-highlighted">
                    {{ t('payments.ready.title') }}
                  </p>
                  <p class="mt-0.5 text-sm text-muted">
                    {{ t('payments.ready.description') }}
                  </p>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <UBadge
                  :color="account?.chargesEnabled ? 'success' : 'neutral'"
                  variant="subtle"
                  :label="t(account?.chargesEnabled ? 'payments.facts.chargesOn' : 'payments.facts.chargesOff')"
                />
                <UBadge
                  :color="account?.payoutsEnabled ? 'success' : 'neutral'"
                  variant="subtle"
                  :label="t(account?.payoutsEnabled ? 'payments.facts.payoutsOn' : 'payments.facts.payoutsOff')"
                />
              </div>
            </div>
          </UCard>
        </MotionReveal>

        <!-- Pricing plans — only once a connected account exists (plans are created
             on it). School roles manage them; onboarding above stays owner-only. -->
        <MotionReveal
          v-if="!loading && account?.configured && accountStatus !== 'none'"
          :delay="0.12"
        >
          <SchoolPaymentsPricingPlans />
        </MotionReveal>

        <!-- The internal money-movement trail (who sent a link / cancelled / refunded). -->
        <MotionReveal
          v-if="!loading && account?.configured && accountStatus !== 'none'"
          :delay="0.16"
        >
          <SchoolPaymentsPaymentActivity />
        </MotionReveal>
      </div>
    </template>
  </UDashboardPanel>
</template>
