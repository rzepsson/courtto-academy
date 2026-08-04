<script setup lang="ts">
import { BILLING_PLANS } from '~~/shared/billing'
import type { PlanId } from '~~/shared/billing'

// The plan grid, shared by /school/billing (manage) and /billing-required (gate).
// Product-neutral display: names/features/prices come from the shared catalog +
// i18n; the subscribe action + spinner come from useBilling. Gated by `canManage`
// (owner) — a non-owner sees the plans but no actions.
const props = withDefaults(defineProps<{
  currentPlanId?: PlanId | null
  configured: boolean
  canManage: boolean
  // Where Stripe Checkout returns on success — the gate sends the owner back into
  // the app (/dashboard re-routes to their home), the settings page stays put.
  successUrl?: string
}>(), {
  currentPlanId: null,
  successUrl: '/school/billing'
})

const { t, locale } = useI18n()
const { pending, upgrade } = useBilling()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UCard
      v-for="plan in BILLING_PLANS"
      :key="plan.id"
      variant="subtle"
      :class="plan.highlighted ? 'ring-2 ring-primary' : ''"
    >
      <div class="flex flex-col gap-4">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-highlighted">
              {{ t(`billing.plans.${plan.id}.name`) }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ t(`billing.plans.${plan.id}.tagline`) }}
            </p>
          </div>
          <UBadge
            v-if="plan.highlighted"
            :label="t('billing.recommended')"
            color="primary"
            variant="subtle"
            size="sm"
          />
        </div>

        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-semibold text-highlighted">
            {{ formatMoney(plan.monthlyPrice, plan.currency, locale) }}
          </span>
          <span class="text-sm text-muted">{{ t('billing.perMonth') }}</span>
        </div>

        <ul class="flex flex-col gap-2">
          <li
            v-for="key in plan.featureKeys"
            :key="key"
            class="flex items-center gap-2 text-sm text-muted"
          >
            <UIcon
              name="i-lucide-check"
              class="size-4 shrink-0 text-primary"
            />
            {{ t(`billing.features.${key}`) }}
          </li>
        </ul>

        <UButton
          v-if="plan.id === currentPlanId"
          block
          color="neutral"
          variant="subtle"
          disabled
          :label="t('billing.currentPlan')"
        />
        <UButton
          v-else
          block
          color="primary"
          :variant="plan.highlighted ? 'solid' : 'subtle'"
          :disabled="!canManage || !configured"
          :loading="pending === plan.id"
          :label="currentPlanId ? t('billing.switchToPlan') : t('billing.choosePlan')"
          @click="upgrade(plan.id, props.successUrl)"
        />
      </div>
    </UCard>
  </div>
</template>
