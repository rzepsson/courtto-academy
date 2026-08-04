<script setup lang="ts">
import { isPaymentAuditAction } from '~~/shared/payment-audit'
import type { PaymentAuditEntryDto } from '~~/server/database/types'

// The internal money-movement trail on /school/payments — who sent a link,
// cancelled a subscription, or issued a refund. Read-only accountability view
// (Stripe stays the authoritative money ledger). Dates arrive serialized.
type ActivityView = Omit<PaymentAuditEntryDto, 'createdAt'> & { createdAt: string }

const { t, locale } = useI18n()

const { data, status } = await useLazyFetch<{ entries: ActivityView[] }>('/api/school/payments/audit', {
  key: 'school:payment-activity'
})
const entries = computed(() => data.value?.entries ?? [])
const loading = computed(() => status.value === 'pending')

const ACTION_ICON: Record<string, string> = {
  checkout_sent: 'i-lucide-mail',
  subscription_canceled: 'i-lucide-circle-x',
  refund_issued: 'i-lucide-undo-2'
}
function iconOf(action: string): string {
  return ACTION_ICON[action] ?? 'i-lucide-receipt'
}
function line(entry: ActivityView): string {
  const actor = entry.actorName ?? t('payments.activity.someone')
  const student = entry.studentName ?? '—'
  return isPaymentAuditAction(entry.action)
    ? t(`payments.activity.actions.${entry.action}`, { actor, student })
    : t('payments.activity.actions.unknown', { actor })
}
</script>

<template>
  <div class="flex flex-col gap-4 rounded-xl bg-default p-5 ring-1 ring-default">
    <div class="flex items-center gap-2">
      <UIcon
        name="i-lucide-history"
        class="size-4 text-dimmed"
      />
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('payments.activity.title') }}
      </h2>
    </div>

    <AppListSkeleton
      v-if="loading"
      :rows="3"
    />

    <p
      v-else-if="entries.length === 0"
      class="rounded-lg bg-elevated/40 px-4 py-8 text-center text-sm text-muted"
    >
      {{ t('payments.activity.empty') }}
    </p>

    <ol
      v-else
      class="flex flex-col gap-3.5"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="flex gap-3"
      >
        <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
          <UIcon
            :name="iconOf(entry.action)"
            class="size-3.5 text-dimmed"
          />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-default">
            {{ line(entry) }}
            <span
              v-if="entry.action === 'refund_issued' && entry.amountMinor != null && entry.currency"
              class="font-medium text-highlighted"
            >· {{ formatMoney(entry.amountMinor, entry.currency, locale) }}</span>
          </p>
          <p class="mt-0.5 text-xs text-dimmed">
            {{ formatRelativeTime(entry.createdAt, locale) }}
          </p>
        </div>
      </li>
    </ol>
  </div>
</template>
