<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'
import type { ScheduleSessionView } from '~/utils/schedule'
import type { RosterEntry } from '~~/server/database/types'
import { ATTENDANCE_STATUSES } from '~~/shared/schedule'

// A session's detail + management. School: reschedule / cancel / restore + roster
// & attendance. Coach: roster & attendance for their own session. My: read-only.
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  session: ScheduleSessionView | null
  timezone: string
  area: 'school' | 'coach' | 'my'
  courts?: CourtView[]
  coaches?: { id: string, name: string }[]
  students?: { id: string, name: string, email: string }[]
}>()

const emit = defineEmits<{ changed: [], edit: [session: ScheduleSessionView] }>()

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const canManage = computed(() => props.area === 'school')
const canAttend = computed(() => props.area === 'school' || props.area === 'coach')
const basePath = computed(() => props.area === 'coach' ? '/api/coach/schedule' : '/api/school/schedule')

const cancelled = computed(() => props.session?.status === 'cancelled')

const when = computed(() => {
  if (!props.session) return ''
  const start = DateTime.fromISO(props.session.startsAt, { zone: props.timezone }).setLocale(locale.value)
  const end = DateTime.fromISO(props.session.endsAt, { zone: props.timezone })
  return `${start.toFormat('cccc d LLLL, HH:mm')}–${end.toFormat('HH:mm')}`
})

const courtName = computed(() =>
  props.courts?.find(c => c.id === props.session?.courtId)?.name ?? null
)
const coachName = computed(() =>
  props.coaches?.find(c => c.id === props.session?.coachMemberId)?.name ?? null
)

// --- Roster + attendance ---
const roster = ref<RosterEntry[]>([])
const rosterLoading = ref(false)
const marks = ref<Record<string, string>>({})
const savingAttendance = ref(false)
// Guards against a slow roster fetch for a previously-opened session overwriting
// the one now on screen (last-write-wins on rapid open/close).
let rosterToken = 0

async function loadRoster() {
  roster.value = []
  marks.value = {}
  if (!props.session || !canAttend.value) return
  const token = ++rosterToken
  rosterLoading.value = true
  try {
    const { roster: rows } = await $fetch<{ roster: RosterEntry[] }>(`${basePath.value}/sessions/${props.session.id}/roster`)
    if (token !== rosterToken) return
    roster.value = rows
    for (const r of rows) {
      if (r.attendanceStatus) marks.value[r.studentMemberId] = r.attendanceStatus
    }
  } catch (error) {
    if (token === rosterToken) toastError('schedule.errors.rosterFailed', error)
  } finally {
    if (token === rosterToken) rosterLoading.value = false
  }
}

watch([open, () => props.session?.id], ([isOpen]) => {
  if (isOpen && props.session) {
    showReschedule.value = false
    loadRoster()
  }
})

async function saveAttendance() {
  if (!props.session) return
  const entries = roster.value
    .filter(r => marks.value[r.studentMemberId])
    .map(r => ({ studentMemberId: r.studentMemberId, status: marks.value[r.studentMemberId] }))
  if (entries.length === 0) return
  savingAttendance.value = true
  try {
    const { roster: rows } = await $fetch<{ roster: RosterEntry[] }>(`${basePath.value}/sessions/${props.session.id}/attendance`, {
      method: 'PUT',
      body: { entries }
    })
    roster.value = rows
    toast.add({ title: t('schedule.attendance.saved'), color: 'success' })
  } catch (error) {
    toastError('schedule.errors.attendanceFailed', error)
  } finally {
    savingAttendance.value = false
  }
}

const attendanceMeta: Record<string, { icon: string, color: string }> = {
  present: { icon: 'i-lucide-check', color: 'text-success' },
  absent: { icon: 'i-lucide-x', color: 'text-error' },
  excused: { icon: 'i-lucide-shield', color: 'text-warning' },
  late: { icon: 'i-lucide-clock', color: 'text-info' }
}

// --- Cancel / restore ---
const busy = ref(false)

async function cancel() {
  if (!props.session) return
  busy.value = true
  const endpoint: string = `/api/school/schedule/sessions/${props.session.id}`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('schedule.session.cancelled'), color: 'neutral' })
    emit('changed')
    open.value = false
  } catch (error) {
    toastError('schedule.errors.cancelFailed', error)
  } finally {
    busy.value = false
  }
}

async function restore() {
  if (!props.session) return
  busy.value = true
  try {
    await $fetch(`/api/school/schedule/sessions/${props.session.id}`, { method: 'PATCH', body: { restore: true } })
    toast.add({ title: t('schedule.session.restored'), color: 'success' })
    emit('changed')
    open.value = false
  } catch (error) {
    toastError('schedule.errors.restoreFailed', error)
  } finally {
    busy.value = false
  }
}

// --- Reschedule (single occurrence) ---
const showReschedule = ref(false)
const edit = reactive({ dtStart: '', durationMin: 60, courtId: '', coachMemberId: '' })

function openReschedule() {
  if (!props.session) return
  edit.dtStart = toLocalDateTimeInput(props.session.startsAt, props.timezone)
  edit.durationMin = durationMinutes(props.session.startsAt, props.session.endsAt)
  edit.courtId = props.session.courtId ?? ''
  edit.coachMemberId = props.session.coachMemberId ?? NO_COACH_VALUE
  showReschedule.value = true
}

// Active courts of the session's sport, plus the session's current court even if
// it was since archived — so the select never shows a blank, un-pickable value.
const courtOptions = computed(() =>
  (props.courts ?? [])
    .filter(c => c.sport === props.session?.sport && (c.archivedAt === null || c.id === props.session?.courtId))
    .map(c => ({ value: c.id, label: c.name }))
)
const coachOptions = computed(() => coachSelectOptions(props.coaches ?? [], t('schedule.form.noCoach')))

async function saveReschedule() {
  if (!props.session) return
  busy.value = true
  try {
    await $fetch(`/api/school/schedule/sessions/${props.session.id}`, {
      method: 'PATCH',
      body: {
        startsAt: edit.dtStart,
        durationMin: edit.durationMin,
        courtId: edit.courtId || undefined,
        coachMemberId: edit.coachMemberId === NO_COACH_VALUE ? '' : edit.coachMemberId
      }
    })
    toast.add({ title: t('schedule.session.rescheduled'), color: 'success' })
    emit('changed')
    open.value = false
  } catch (error) {
    toastError('schedule.errors.rescheduleFailed', error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="session?.seriesTitle ?? t('schedule.session.title')"
    :ui="{ content: 'max-w-lg w-full' }"
  >
    <template #body>
      <div
        v-if="session"
        class="flex flex-col gap-6"
      >
        <!-- Summary -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span
              class="size-3 rounded-full"
              :style="{ backgroundColor: session.color }"
            />
            <ScheduleSessionBadge :status="session.status" />
            <UBadge
              v-if="session.overridden"
              :label="t('schedule.session.overridden')"
              color="warning"
              variant="subtle"
              size="sm"
            />
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt class="text-muted">
              {{ t('schedule.session.when') }}
            </dt>
            <dd class="text-highlighted">
              {{ when }}
            </dd>
            <dt class="text-muted">
              {{ t('schedule.session.court') }}
            </dt>
            <dd class="text-highlighted">
              {{ courtName ?? '—' }}
            </dd>
            <dt class="text-muted">
              {{ t('schedule.session.coach') }}
            </dt>
            <dd class="text-highlighted">
              {{ coachName ?? t('schedule.session.noCoach') }}
            </dd>
          </dl>
        </div>

        <!-- School management -->
        <div
          v-if="canManage"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-wrap gap-2">
            <UButton
              color="neutral"
              variant="subtle"
              icon="i-lucide-pencil"
              :label="t('schedule.session.edit')"
              @click="session && emit('edit', session)"
            />
            <UButton
              v-if="!cancelled"
              color="neutral"
              variant="subtle"
              icon="i-lucide-calendar-clock"
              :label="t('schedule.session.reschedule')"
              @click="openReschedule"
            />
            <UButton
              v-if="!cancelled"
              color="error"
              variant="subtle"
              icon="i-lucide-calendar-x"
              :loading="busy"
              :label="t('schedule.session.cancel')"
              @click="cancel"
            />
            <UButton
              v-else
              color="primary"
              variant="subtle"
              icon="i-lucide-rotate-ccw"
              :loading="busy"
              :label="t('schedule.session.restore')"
              @click="restore"
            />
          </div>

          <div
            v-if="showReschedule"
            class="flex flex-col gap-4 rounded-lg bg-elevated/40 p-4 ring-1 ring-default"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField
                :label="t('schedule.form.dtStart')"
                class="sm:col-span-2"
              >
                <AppDateTimeField v-model="edit.dtStart" />
              </UFormField>
              <UFormField :label="t('schedule.form.duration')">
                <UInput
                  v-model.number="edit.durationMin"
                  type="number"
                  :min="5"
                  :step="5"
                  class="w-full"
                />
              </UFormField>
              <UFormField :label="t('schedule.form.court')">
                <USelectMenu
                  v-model="edit.courtId"
                  value-key="value"
                  :items="courtOptions"
                  :search-input="{ placeholder: t('common.search') }"
                  icon="i-lucide-land-plot"
                  class="w-full"
                />
              </UFormField>
              <UFormField :label="t('schedule.form.coach')">
                <USelectMenu
                  v-model="edit.coachMemberId"
                  value-key="value"
                  :items="coachOptions"
                  :search-input="{ placeholder: t('common.search') }"
                  icon="i-lucide-user-round"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :label="t('common.cancel')"
                @click="showReschedule = false"
              />
              <PressButton
                :block="false"
                size="md"
                icon="i-lucide-check"
                :loading="busy"
                :label="t('common.save')"
                @click="saveReschedule"
              />
            </div>
          </div>
        </div>

        <!-- Enrolment management (school only). Series-scoped, so it stays
             available even for a single cancelled occurrence. -->
        <ScheduleEnrollmentManager
          v-if="canManage"
          :session="session"
          :students="students ?? []"
          @changed="loadRoster()"
        />

        <!-- Roster + attendance -->
        <div
          v-if="canAttend"
          class="flex flex-col gap-3"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-highlighted">
              {{ t('schedule.attendance.title') }}
            </h3>
            <UButton
              v-if="roster.length"
              size="xs"
              color="primary"
              variant="subtle"
              icon="i-lucide-save"
              :loading="savingAttendance"
              :label="t('schedule.attendance.save')"
              @click="saveAttendance"
            />
          </div>

          <AppListSkeleton
            v-if="rosterLoading"
            :rows="3"
          />
          <p
            v-else-if="roster.length === 0"
            class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted"
          >
            {{ t('schedule.attendance.empty') }}
          </p>
          <ul
            v-else
            class="divide-y divide-default"
          >
            <li
              v-for="r in roster"
              :key="r.studentMemberId"
              class="flex items-center justify-between gap-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ r.studentName }}
                </p>
                <p class="truncate text-xs text-muted">
                  {{ t(`schedule.rosterSource.${r.source}`) }}
                </p>
              </div>
              <div class="flex gap-1">
                <button
                  v-for="status in ATTENDANCE_STATUSES"
                  :key="status"
                  type="button"
                  class="flex size-8 items-center justify-center rounded-full ring-1 transition-colors"
                  :class="marks[r.studentMemberId] === status
                    ? 'bg-elevated ring-inverted/20'
                    : 'ring-default hover:ring-inverted/20'"
                  :aria-label="t(`schedule.attendanceStatus.${status}`)"
                  :title="t(`schedule.attendanceStatus.${status}`)"
                  @click="marks[r.studentMemberId] = status"
                >
                  <UIcon
                    :name="attendanceMeta[status]!.icon"
                    class="size-4"
                    :class="marks[r.studentMemberId] === status ? attendanceMeta[status]!.color : 'text-dimmed'"
                  />
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- Student read-only enrolment status -->
        <div
          v-if="area === 'my'"
          class="rounded-lg bg-elevated/40 px-4 py-3 text-sm ring-1 ring-default"
        >
          {{ t('schedule.session.myStatusIntro') }}
        </div>
      </div>
    </template>
  </USlideover>
</template>
