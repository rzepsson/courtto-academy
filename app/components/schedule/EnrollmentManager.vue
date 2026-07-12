<script setup lang="ts">
import type { ScheduleSessionView } from '~/utils/schedule'
import type { EnrollmentView, SeriesEnrollmentSummary } from '~~/server/database/types'

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

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const summary = ref<SeriesEnrollmentSummary | null>(null)
const enrollments = ref<EnrollmentView[]>([])
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
    const data = await $fetch<{ series: SeriesEnrollmentSummary, enrollments: EnrollmentView[] }>(
      `/api/school/schedule/${seriesId.value}/enrollments`
    )
    if (current !== token) return
    summary.value = data.series
    enrollments.value = data.enrollments
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
      <h3 class="text-sm font-semibold text-highlighted">
        {{ t('schedule.enrollment.title') }}
      </h3>
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
</template>
