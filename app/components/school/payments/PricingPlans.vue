<script setup lang="ts">
import { pricingPlanCreateSchema, pricingPlanPatchSchema } from '~~/shared/pricing-plan-schema'
import type { PricingPlanDto } from '~~/server/database/types'

// Manager for a school's monthly pricing plans. All viewers of /school/payments are
// school roles (owner/admin), so plan management is always available here. The
// amount is edited in major units but stored/validated as integer minor units.
const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const { data, refresh } = await useLazyFetch<{ plans: PricingPlanDto[], currency: string }>('/api/school/pricing-plans', {
  key: 'school:pricing-plans',
  query: { includeArchived: '1' }
})
const plans = computed(() => data.value?.plans ?? [])
const currency = computed(() => data.value?.currency ?? 'PLN')
const activePlans = computed(() => plans.value.filter(plan => !plan.archivedAt))
const archivedPlans = computed(() => plans.value.filter(plan => plan.archivedAt))

const open = ref(false)
const editing = ref<PricingPlanDto | null>(null)
const submitting = ref(false)
const state = reactive({ name: '', description: '', amountMinor: 0 })

const schema = computed(() =>
  (editing.value ? pricingPlanPatchSchema : pricingPlanCreateSchema)(code => t(`payments.plans.errors.${code}`))
)

// Edit in major units (200,00), store integer grosze.
const amountMajor = computed({
  get: () => (state.amountMinor ? state.amountMinor / 100 : undefined),
  set: (value) => { state.amountMinor = value ? Math.round(value * 100) : 0 }
})

function openCreate() {
  editing.value = null
  state.name = ''
  state.description = ''
  state.amountMinor = 0
  open.value = true
}

function openEdit(plan: PricingPlanDto) {
  editing.value = plan
  state.name = plan.name
  state.description = plan.description ?? ''
  state.amountMinor = plan.amountMinor
  open.value = true
}

async function submit() {
  submitting.value = true
  const body = { name: state.name, description: state.description, amountMinor: state.amountMinor }
  try {
    if (editing.value) {
      const endpoint: string = `/api/school/pricing-plans/${editing.value.id}`
      await $fetch(endpoint, { method: 'PATCH', body })
      toast.add({ title: t('payments.plans.updated'), color: 'success' })
    } else {
      await $fetch('/api/school/pricing-plans', { method: 'POST', body })
      toast.add({ title: t('payments.plans.created'), color: 'success' })
    }
    open.value = false
    await refresh()
  } catch (error) {
    toastError('payments.plans.saveFailed', error)
  } finally {
    submitting.value = false
  }
}

async function archive(plan: PricingPlanDto) {
  const endpoint: string = `/api/school/pricing-plans/${plan.id}`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('payments.plans.archived'), color: 'neutral' })
    await refresh()
  } catch (error) {
    toastError('payments.plans.saveFailed', error)
  }
}

async function restore(plan: PricingPlanDto) {
  const endpoint: string = `/api/school/pricing-plans/${plan.id}`
  try {
    await $fetch(endpoint, { method: 'PATCH', body: { restore: true } })
    toast.add({ title: t('payments.plans.restored'), color: 'success' })
    await refresh()
  } catch (error) {
    toastError('payments.plans.saveFailed', error)
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 rounded-xl bg-default p-5 ring-1 ring-default">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-tags"
          class="size-4 text-dimmed"
        />
        <h2 class="text-sm font-semibold text-highlighted">
          {{ t('payments.plans.title') }}
        </h2>
      </div>
      <UButton
        color="primary"
        variant="subtle"
        size="sm"
        icon="i-lucide-plus"
        :label="t('payments.plans.add')"
        @click="openCreate()"
      />
    </div>

    <p class="-mt-1 text-sm text-muted">
      {{ t('payments.plans.subtitle') }}
    </p>

    <p
      v-if="activePlans.length === 0 && archivedPlans.length === 0"
      class="rounded-lg bg-elevated/40 px-4 py-8 text-center text-sm text-muted"
    >
      {{ t('payments.plans.empty') }}
    </p>

    <ul
      v-else
      class="flex flex-col divide-y divide-default"
    >
      <li
        v-for="plan in activePlans"
        :key="plan.id"
        class="flex items-center gap-3 py-3 first:pt-0"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium text-highlighted">
            {{ plan.name }}
          </p>
          <p
            v-if="plan.description"
            class="truncate text-xs text-muted"
          >
            {{ plan.description }}
          </p>
        </div>
        <span class="shrink-0 text-sm font-medium tabular-nums text-highlighted">
          {{ formatMoney(plan.amountMinor, plan.currency, locale) }}<span class="text-dimmed">{{ t('billing.perMonth') }}</span>
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-pencil"
            :aria-label="t('common.save')"
            @click="openEdit(plan)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-archive"
            :aria-label="t('payments.plans.archive')"
            @click="archive(plan)"
          />
        </div>
      </li>
    </ul>

    <div
      v-if="archivedPlans.length"
      class="flex flex-col gap-2"
    >
      <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
        {{ t('payments.plans.archivedSection') }}
      </p>
      <ul class="flex flex-col divide-y divide-default">
        <li
          v-for="plan in archivedPlans"
          :key="plan.id"
          class="flex items-center gap-3 py-2.5 opacity-70"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-muted line-through">{{ plan.name }}</span>
          <span class="shrink-0 text-sm tabular-nums text-muted">
            {{ formatMoney(plan.amountMinor, plan.currency, locale) }}
          </span>
          <UButton
            color="neutral"
            variant="subtle"
            size="xs"
            :label="t('payments.plans.restore')"
            @click="restore(plan)"
          />
        </li>
      </ul>
    </div>

    <USlideover
      v-model:open="open"
      :title="editing ? t('payments.plans.editTitle') : t('payments.plans.addTitle')"
    >
      <template #body>
        <UForm
          :schema="schema"
          :state="state"
          class="flex flex-col gap-4"
          @submit="submit"
        >
          <UFormField
            :label="t('payments.plans.fields.name')"
            name="name"
            required
          >
            <UInput
              v-model="state.name"
              class="w-full"
              :placeholder="t('payments.plans.fields.namePlaceholder')"
            />
          </UFormField>

          <UFormField
            :label="t('payments.plans.fields.description')"
            name="description"
          >
            <UTextarea
              v-model="state.description"
              class="w-full"
              :rows="2"
              :placeholder="t('payments.plans.fields.descriptionPlaceholder')"
            />
          </UFormField>

          <UFormField
            :label="t('payments.plans.fields.amount')"
            name="amountMinor"
            required
          >
            <UInput
              v-model.number="amountMajor"
              type="number"
              :min="0"
              :step="0.01"
              class="w-full"
            >
              <template #trailing>
                <span class="text-xs text-dimmed">{{ currency }}{{ t('billing.perMonth') }}</span>
              </template>
            </UInput>
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="open = false"
            />
            <UButton
              type="submit"
              color="primary"
              :loading="submitting"
              :label="editing ? t('common.save') : t('payments.plans.add')"
            />
          </div>
        </UForm>
      </template>
    </USlideover>
  </div>
</template>
