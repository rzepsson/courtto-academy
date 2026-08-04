<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ScheduleSessionView } from '~/utils/schedule'
import type { EnrollmentView, SeriesBillingContext, SeriesEnrollmentSummary } from '~~/server/database/types'

// String-dated over HTTP (mirrors EnrollmentBillingSummary with a serialized date).
type BillingSummaryView = { status: string, cancelAtPeriodEnd: boolean, currentPeriodEnd: string | null }

// Staff enrolment panel for a lesson's series ("add a student to the group").
// Shows the seat meter, the enrolled roster and the waitlist, and a searchable
// student picker to enrol someone. Series-scoped — the group is the series, so a
// drop-in student added here counts against the same capacity via the series lock
// on the server. School-only; mounted inside the session slideover.
const props = defineProps<{
  session: ScheduleSessionView
  students: { id: string, name: string, email: string }[]
}>()

const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const summary = ref<SeriesEnrollmentSummary | null>(null)
const enrollments = ref<EnrollmentView[]>([])
const billing = ref<Record<string, BillingSummaryView>>({})
const billingContext = ref<SeriesBillingContext | null>(null)
const billingActionId = ref<string | null>(null)
const loading = ref(false)
const addSelection = ref<string | undefined>(undefined)
const adding = ref(false)
const removingId = ref<string | null>(null)
// Guards a slow fetch for a previously-open session from overwriting the current.
let token = 0

const seriesId = computed(() => props.session.seriesId)

async function load() {
  const current = ++token
  loading.value = true
  try {
    const data = await $fetch<{ series: SeriesEnrollmentSummary, enrollments: EnrollmentView[], billing: Record<string, BillingSummaryView>, billingContext: SeriesBillingContext }>(
      `/api/school/schedule/${seriesId.value}/enrollments`
    )
    if (current !== token) return
    summary.value = data.series
    enrollments.value = data.enrollments
    billing.value = data.billing
    billingContext.value = data.billingContext
  } catch (error) {
    if (current === token) toastError('schedule.enrollment.errors.loadFailed', error)
  } finally {
    if (current === token) loading.value = false
  }
}

onMounted(load)
watch(seriesId, () => {
  addSelection.value = undefined
  load()
})

const enrolled = computed(() => enrollments.value.filter(e => e.status === 'enrolled'))
const waitlisted = computed(() =>
  enrollments.value
    .filter(e => e.status === 'waitlisted')
    .sort((a, b) => (a.waitlistPos ?? 0) - (b.waitlistPos ?? 0))
)

// Every student already on the series (enrolled or waitlisted) is off the picker.
const takenIds = computed(() => new Set(enrollments.value.map(e => e.studentMemberId)))
const candidates = computed(() =>
  props.students
    .filter(s => !takenIds.value.has(s.id))
    .map(s => ({ label: s.name, value: s.id, email: s.email }))
)

const capacityMax = computed(() => summary.value?.capacityMax ?? null)
const enrollmentOpen = computed(() => summary.value?.enrollmentOpen ?? true)
const canAdd = computed(() => candidates.value.length > 0)

// --- Billing (only shown when the group has an active plan and the school can charge) ---
const { data: appContext } = useAppContext()
// Refunds move money OUT, so they're owner-only (matches the server guard).
const isOwner = computed(() => activeMembershipOf(appContext.value)?.role === 'owner')
const canBill = computed(() => Boolean(billingContext.value?.plan && billingContext.value?.paymentsReady))
const planLabel = computed(() => {
  const plan = billingContext.value?.plan
  return plan ? formatMoney(plan.amountMinor, plan.currency, locale.value) : ''
})

const BILLING_COLOR: Record<string, 'neutral' | 'warning' | 'success' | 'error'> = {
  none: 'neutral', pending_payment: 'warning', active: 'success', past_due: 'error', canceled: 'neutral'
}
const BADGE_KEY: Record<string, string> = {
  none: 'none', pending_payment: 'pending', active: 'active', past_due: 'pastDue', canceled: 'canceled'
}

function summaryOf(id: string): BillingSummaryView | null {
  return billing.value[id] ?? null
}
function statusOf(id: string): string {
  return summaryOf(id)?.status ?? 'none'
}
// Active/past_due spots are managed via the dropdown; the rest still need a link sent.
function isManaged(id: string): boolean {
  const status = statusOf(id)
  return status === 'active' || status === 'past_due'
}
function badge(id: string): { color: 'neutral' | 'warning' | 'success' | 'error', label: string } {
  const summary = summaryOf(id)
  // A spot set to cancel still reads `active` on Stripe until the period end — surface
  // that it's ending so staff aren't surprised when it stops.
  if (summary?.cancelAtPeriodEnd && summary.status === 'active') {
    return {
      color: 'warning',
      label: summary.currentPeriodEnd
        ? t('schedule.billing.endsOn', { date: formatDate(summary.currentPeriodEnd, locale.value) })
        : t('schedule.billing.ending')
    }
  }
  return { color: BILLING_COLOR[statusOf(id)] ?? 'neutral', label: t(`schedule.billing.${BADGE_KEY[statusOf(id)] ?? 'none'}`) }
}

async function sendLink(entry: EnrollmentView) {
  if (billingActionId.value) return
  billingActionId.value = entry.id
  try {
    await $fetch(`/api/school/schedule/enrollments/${entry.id}/checkout`, { method: 'POST' })
    toast.add({ title: t('schedule.billing.linkSent'), color: 'success' })
    await load()
  } catch (error) {
    toastError('schedule.billing.actionFailed', error)
  } finally {
    billingActionId.value = null
  }
}

async function manage(entry: EnrollmentView) {
  if (billingActionId.value) return
  billingActionId.value = entry.id
  try {
    const { url } = await $fetch<{ url: string }>(`/api/school/schedule/enrollments/${entry.id}/portal`, { method: 'POST' })
    await navigateTo(url, { external: true })
  } catch (error) {
    toastError('schedule.billing.actionFailed', error)
    billingActionId.value = null
  }
}

// Cancel + refund are confirmed (stopping billing / moving money out).
const confirmOpen = ref(false)
const confirming = ref(false)
const confirmAction = ref<{ type: 'cancel' | 'refund', entry: EnrollmentView } | null>(null)

function ask(type: 'cancel' | 'refund', entry: EnrollmentView) {
  confirmAction.value = { type, entry }
  confirmOpen.value = true
}

async function runConfirmed() {
  const action = confirmAction.value
  if (!action || confirming.value) return
  confirming.value = true
  try {
    if (action.type === 'cancel') {
      await $fetch(`/api/school/schedule/enrollments/${action.entry.id}/cancel`, { method: 'POST' })
      toast.add({ title: t('schedule.billing.cancelled'), color: 'neutral' })
    } else {
      await $fetch(`/api/school/schedule/enrollments/${action.entry.id}/refund`, { method: 'POST' })
      toast.add({ title: t('schedule.billing.refunded'), color: 'success' })
    }
    confirmOpen.value = false
    await load()
  } catch (error) {
    toastError('schedule.billing.actionFailed', error)
  } finally {
    confirming.value = false
  }
}

function menuItems(entry: EnrollmentView): DropdownMenuItem[][] {
  const items: DropdownMenuItem[] = [
    { label: t('schedule.billing.manage'), icon: 'i-lucide-external-link', onSelect: () => manage(entry) },
    { label: t('schedule.billing.cancel'), icon: 'i-lucide-circle-x', onSelect: () => ask('cancel', entry) }
  ]
  if (isOwner.value) {
    items.push({ label: t('schedule.billing.refund'), icon: 'i-lucide-undo-2', color: 'error', onSelect: () => ask('refund', entry) })
  }
  return [items]
}

async function add() {
  if (!addSelection.value || adding.value) return
  adding.value = true
  try {
    const { enrollment } = await $fetch<{ enrollment: { status: string } }>(
      `/api/school/schedule/${seriesId.value}/enrollments`,
      { method: 'POST', body: { studentMemberId: addSelection.value } }
    )
    toast.add({
      title: enrollment.status === 'waitlisted' ? t('schedule.enrollment.waitlisted') : t('schedule.enrollment.added'),
      color: enrollment.status === 'waitlisted' ? 'warning' : 'success'
    })
    addSelection.value = undefined
    await load()
    emit('changed')
  } catch (error) {
    toastError('schedule.enrollment.errors.addFailed', error)
  } finally {
    adding.value = false
  }
}

async function remove(entry: EnrollmentView) {
  if (removingId.value) return
  removingId.value = entry.id
  try {
    await $fetch(`/api/school/schedule/enrollments/${entry.id}`, { method: 'DELETE' })
    toast.add({ title: t('schedule.enrollment.removed'), color: 'neutral' })
    await load()
    emit('changed')
  } catch (error) {
    toastError('schedule.enrollment.errors.removeFailed', error)
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <h3 class="text-sm font-semibold text-highlighted">
          {{ t('schedule.enrollment.title') }}
        </h3>
        <UBadge
          v-if="billingContext?.plan"
          color="primary"
          variant="subtle"
          size="sm"
          :label="`${planLabel}${t('billing.perMonth')}`"
        />
      </div>
      <span class="text-xs tabular-nums text-muted">
        {{ capacityMax !== null ? t('schedule.enrollment.countOf', { n: enrolled.length, max: capacityMax }) : t('schedule.enrollment.count', { n: enrolled.length }) }}
      </span>
    </div>

    <UProgress
      v-if="capacityMax !== null"
      :model-value="Math.min(enrolled.length, capacityMax)"
      :max="capacityMax"
      :color="enrolled.length >= capacityMax ? 'warning' : 'primary'"
      size="sm"
    />

    <!-- Add a student. Staff can add even when self-enrolment is closed. -->
    <div class="flex items-center gap-2">
      <USelectMenu
        v-model="addSelection"
        value-key="value"
        :items="candidates"
        description-key="email"
        :disabled="candidates.length === 0"
        :placeholder="candidates.length ? t('schedule.enrollment.pickStudent') : t('schedule.enrollment.allEnrolled')"
        icon="i-lucide-user-plus"
        :search-input="{ placeholder: t('schedule.enrollment.searchStudent') }"
        class="flex-1"
      />
      <PressButton
        :block="false"
        size="md"
        icon="i-lucide-plus"
        :label="t('schedule.enrollment.add')"
        :loading="adding"
        :disabled="!addSelection || !canAdd"
        @click="add"
      />
    </div>
    <p
      v-if="!enrollmentOpen"
      class="flex items-center gap-2 text-xs text-muted"
    >
      <UIcon
        name="i-lucide-lock"
        class="size-3.5 shrink-0"
      />
      {{ t('schedule.enrollment.closedStaffCanAdd') }}
    </p>

    <!-- Roster -->
    <AppListSkeleton
      v-if="loading"
      :rows="2"
    />
    <template v-else>
      <p
        v-if="enrolled.length === 0"
        class="rounded-lg border border-dashed border-default py-6 text-center text-sm text-muted"
      >
        {{ t('schedule.enrollment.empty') }}
      </p>
      <ul
        v-else
        class="divide-y divide-default"
      >
        <li
          v-for="entry in enrolled"
          :key="entry.id"
          class="flex items-center justify-between gap-3 py-2"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <UAvatar
              :alt="entry.studentName"
              size="xs"
            />
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ entry.studentName }}
              </p>
              <p class="truncate text-xs text-muted">
                {{ entry.studentEmail }}
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <template v-if="canBill">
              <UBadge
                :color="badge(entry.id).color"
                variant="subtle"
                size="sm"
                :label="badge(entry.id).label"
              />
              <UDropdownMenu
                v-if="isManaged(entry.id)"
                :items="menuItems(entry)"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-ellipsis-vertical"
                  :loading="billingActionId === entry.id"
                  :aria-label="t('schedule.billing.actions')"
                />
              </UDropdownMenu>
              <UButton
                v-else
                color="primary"
                variant="subtle"
                size="xs"
                icon="i-lucide-mail"
                :loading="billingActionId === entry.id"
                :label="statusOf(entry.id) === 'pending_payment' ? t('schedule.billing.resend') : t('schedule.billing.sendLink')"
                @click="sendLink(entry)"
              />
            </template>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-user-minus"
              :aria-label="t('schedule.enrollment.remove')"
              :loading="removingId === entry.id"
              @click="remove(entry)"
            />
          </div>
        </li>
      </ul>

      <!-- Waitlist -->
      <div
        v-if="waitlisted.length"
        class="flex flex-col gap-2"
      >
        <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">
          {{ t('schedule.enrollment.waitlistTitle', { n: waitlisted.length }) }}
        </p>
        <ul class="divide-y divide-default">
          <li
            v-for="entry in waitlisted"
            :key="entry.id"
            class="flex items-center justify-between gap-3 py-2"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-medium tabular-nums text-muted">
                {{ entry.waitlistPos }}
              </span>
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ entry.studentName }}
                </p>
                <p class="truncate text-xs text-muted">
                  {{ entry.studentEmail }}
                </p>
              </div>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-user-minus"
              :aria-label="t('schedule.enrollment.remove')"
              :loading="removingId === entry.id"
              @click="remove(entry)"
            />
          </li>
        </ul>
      </div>
    </template>
  </section>

  <UModal
    :open="confirmOpen"
    :title="confirmAction?.type === 'refund' ? t('schedule.billing.refundConfirm.title') : t('schedule.billing.cancelConfirm.title')"
    @update:open="(value: boolean) => { if (!value) confirmOpen = false }"
  >
    <template #body>
      <UAlert
        :color="confirmAction?.type === 'refund' ? 'error' : 'warning'"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="confirmAction?.type === 'refund' ? t('schedule.billing.refundConfirm.warningTitle') : t('schedule.billing.cancelConfirm.warningTitle')"
        :description="confirmAction?.type === 'refund'
          ? t('schedule.billing.refundConfirm.warningBody', { name: confirmAction?.entry.studentName })
          : t('schedule.billing.cancelConfirm.warningBody', { name: confirmAction?.entry.studentName })"
      />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="confirmOpen = false"
        />
        <UButton
          :color="confirmAction?.type === 'refund' ? 'error' : 'primary'"
          :loading="confirming"
          :label="confirmAction?.type === 'refund' ? t('schedule.billing.refund') : t('schedule.billing.cancel')"
          @click="runConfirmed"
        />
      </div>
    </template>
  </UModal>
</template>
