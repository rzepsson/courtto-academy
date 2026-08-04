<script setup lang="ts">
// Terminal gate for a school whose subscription has lapsed (app trial elapsed or a
// payment failed). Carries the `auth` layout (which exposes sign-out) and ONLY the
// `auth` middleware — deliberately no area guard, so an unentitled school lands
// here without a redirect loop, and this is where the owner subscribes. Non-owners
// can't move money, so they get a "contact the owner" message + a switch to another
// school where they're still active.
definePageMeta({ layout: 'auth', middleware: 'auth' })

const { t } = useI18n()
const { data: context } = await useAppContext()
const { switching, switchTo } = useOrgSwitch()
const { pending: actionPending, openPortal } = useBilling()

const active = computed(() => activeMembershipOf(context.value))
const isOwner = computed(() => active.value?.role === 'owner')
const orgName = computed(() => active.value?.organization.name ?? '')
const status = computed(() => context.value?.entitlement?.status ?? 'none')
const pastDue = computed(() => status.value === 'past_due')

// Only the owner may (and is allowed by the API to) read billing; a non-owner
// skips the fetch entirely.
const { data: billing } = await useLazyFetch('/api/school/billing', {
  immediate: isOwner.value
})
const configured = computed(() => billing.value?.configured ?? false)
const hasSubscription = computed(() => Boolean(billing.value?.subscription))

const otherActive = computed(() =>
  (context.value?.memberships ?? []).filter(m => m.status === 'active' && m.id !== active.value?.id)
)
</script>

<template>
  <div class="flex w-full flex-col items-center text-center">
    <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
      <UIcon
        :name="pastDue ? 'i-lucide-credit-card' : 'i-lucide-lock'"
        class="size-7 text-dimmed"
      />
    </div>
    <h1 class="mt-5 text-lg font-semibold text-highlighted">
      {{ pastDue ? t('billingRequired.pastDue.title') : t('billingRequired.expired.title') }}
    </h1>
    <p class="mt-2 max-w-sm text-sm text-muted">
      {{ (pastDue ? t('billingRequired.pastDue.description', { org: orgName }) : t('billingRequired.expired.description', { org: orgName })) }}
    </p>

    <!-- Owner: subscribe / fix payment here (this page has no area guard). -->
    <template v-if="isOwner">
      <div
        v-if="!configured"
        class="mt-8 w-full"
      >
        <UAlert
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
          :title="t('billing.notConfigured.title')"
          :description="t('billing.notConfigured.description')"
        />
      </div>

      <template v-else>
        <UButton
          v-if="hasSubscription"
          class="mt-8"
          color="primary"
          icon="i-lucide-external-link"
          :loading="actionPending === 'portal'"
          :label="t('billing.manage')"
          @click="openPortal('/dashboard')"
        />

        <div class="mt-8 w-full">
          <BillingPlanPicker
            :current-plan-id="null"
            :configured="configured"
            can-manage
            success-url="/dashboard"
          />
        </div>
      </template>
    </template>

    <!-- Non-owner: can't manage billing — point them at the owner. -->
    <p
      v-else
      class="mt-8 max-w-sm text-sm text-muted"
    >
      {{ t('billingRequired.contactOwner') }}
    </p>

    <div
      v-if="otherActive.length"
      class="mt-8 w-full"
    >
      <p class="text-xs font-medium tracking-wide text-dimmed uppercase">
        {{ t('accessPaused.switchTitle') }}
      </p>
      <div class="mt-3 flex flex-col gap-2">
        <UButton
          v-for="m in otherActive"
          :key="m.id"
          color="neutral"
          variant="subtle"
          block
          :loading="switching"
          trailing-icon="i-lucide-arrow-right"
          :label="t('accessPaused.switch', { org: m.organization.name })"
          @click="switchTo(m.organization.id)"
        />
      </div>
    </div>
  </div>
</template>
