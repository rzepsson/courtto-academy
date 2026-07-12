<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'
import type { LessonDetail } from '~~/server/database/types'

// Edit a lesson SERIES (school): the non-structural fields the server accepts —
// title, colour, capacity and enrolment policy (metadata PATCH) plus the lead
// coach and default court (assignment PATCH, which propagates to future,
// non-overridden occurrences). Time, duration, recurrence, type and sport are
// structural and stay read-only here (single-occurrence moves use reschedule).
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  seriesId: string | null
  courts: CourtView[]
  coaches: { id: string, name: string }[]
}>()

const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const form = useTemplateRef('form')

const state = reactive({
  title: '',
  color: DEFAULT_LESSON_COLOR,
  capacityMax: null as number | null,
  enrollmentOpen: true,
  coachMemberId: NO_COACH_VALUE,
  defaultCourtId: ''
})
const sport = ref('')
const timezone = ref('Europe/Warsaw')
const loading = ref(false)
const saving = ref(false)
// The persisted assignment, to detect whether a coach/court PATCH is needed.
const original = reactive({ coachMemberId: NO_COACH_VALUE, defaultCourtId: '' })
let token = 0

// Structural edit (start / duration / recurrence) — its own destructive save that
// re-materializes future occurrences. Separate from the metadata form above.
const schedule = reactive({ dtStart: '', durationMin: 60, freq: 'none' as RecurrenceFreq, byday: [] as string[] })
const hasFuture = ref(false)
const showSchedule = ref(false)
const savingSchedule = ref(false)
const scheduleStartWeekday = computed(() => {
  const dt = DateTime.fromISO(schedule.dtStart, { zone: timezone.value })
  return dt.isValid ? SCHEDULE_WEEKDAYS[dt.weekday - 1]! : 'MO'
})

async function load() {
  if (!props.seriesId) return
  const current = ++token
  loading.value = true
  try {
    const { lesson } = await $fetch<{ lesson: LessonDetail }>(`/api/school/schedule/${props.seriesId}`)
    if (current !== token) return
    const s = lesson.series
    state.title = s.title
    state.color = s.color
    state.capacityMax = s.capacityMax
    state.enrollmentOpen = s.enrollmentOpen
    state.coachMemberId = s.coachMemberId ?? NO_COACH_VALUE
    state.defaultCourtId = s.defaultCourtId ?? ''
    sport.value = s.sport
    timezone.value = s.timezone
    original.coachMemberId = state.coachMemberId
    original.defaultCourtId = state.defaultCourtId

    schedule.dtStart = s.dtStart
    schedule.durationMin = s.durationMin
    const recurrence = parseRecurrence(s.rrule)
    schedule.freq = recurrence.freq
    schedule.byday = recurrence.byday
    showSchedule.value = false
    const nowMs = Date.now()
    hasFuture.value = lesson.sessions.some(session => new Date(session.startsAt).getTime() >= nowMs)
  } catch (error) {
    if (current === token) toastError('schedule.edit.errors.loadFailed', error)
  } finally {
    if (current === token) loading.value = false
  }
}

watch([open, () => props.seriesId], ([isOpen]) => {
  if (isOpen && props.seriesId) load()
})

// Courts of the series' sport; keep the current default court even if archived,
// so the select never shows a blank, un-pickable value.
const courtOptions = computed(() =>
  props.courts
    .filter(c => c.sport === sport.value && (c.archivedAt === null || c.id === original.defaultCourtId))
    .map(c => ({ value: c.id, label: c.name }))
)
const coachOptions = computed(() => coachSelectOptions(props.coaches, t('schedule.form.noCoach')))
const formSchema = computed(() => scheduleMetadataFormSchema(t))

async function onSubmit() {
  if (!props.seriesId) return
  saving.value = true
  const seriesId = props.seriesId
  try {
    // Assignment first (the conflict-prone change): if it fails, metadata is
    // left untouched rather than half-applied.
    const assignment: Record<string, unknown> = {}
    if (state.coachMemberId !== original.coachMemberId) {
      assignment.coachMemberId = state.coachMemberId === NO_COACH_VALUE ? '' : state.coachMemberId
    }
    if (state.defaultCourtId !== original.defaultCourtId) {
      assignment.defaultCourtId = state.defaultCourtId
    }
    if (Object.keys(assignment).length > 0) {
      await $fetch(`/api/school/schedule/${seriesId}/assignment`, { method: 'PATCH', body: assignment })
    }

    await $fetch(`/api/school/schedule/${seriesId}`, {
      method: 'PATCH',
      body: {
        title: state.title.trim(),
        color: state.color,
        capacityMax: typeof state.capacityMax === 'number' && Number.isFinite(state.capacityMax) ? state.capacityMax : null,
        enrollmentOpen: state.enrollmentOpen
      }
    })

    toast.add({ title: t('schedule.edit.saved'), color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('schedule.edit.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}

async function saveSchedule() {
  if (!props.seriesId) return
  savingSchedule.value = true
  try {
    await $fetch(`/api/school/schedule/${props.seriesId}/schedule`, {
      method: 'PATCH',
      body: {
        dtStart: schedule.dtStart,
        durationMin: schedule.durationMin,
        rrule: buildRRule(schedule.freq, schedule.byday, scheduleStartWeekday.value)
      }
    })
    toast.add({ title: t('schedule.edit.scheduleSaved'), color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('schedule.edit.errors.scheduleFailed', error)
  } finally {
    savingSchedule.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('schedule.edit.title')"
    :description="t('schedule.edit.subtitle')"
    :ui="{ content: 'max-w-xl w-full' }"
  >
    <template #body>
      <div
        v-if="loading"
        class="flex flex-col gap-5"
      >
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-24 w-full" />
      </div>

      <div
        v-else
        class="flex flex-col gap-6"
      >
        <UForm
          ref="form"
          :state="state"
          :schema="formSchema"
          class="flex flex-col gap-5"
          @submit="onSubmit"
        >
          <UFormField
            :label="t('schedule.form.title')"
            name="title"
            required
          >
            <UInput
              v-model="state.title"
              size="lg"
              class="w-full"
              :placeholder="t('schedule.form.titlePlaceholder')"
            />
          </UFormField>

          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField
              :label="t('schedule.form.court')"
              name="defaultCourtId"
              required
            >
              <USelectMenu
                v-model="state.defaultCourtId"
                value-key="value"
                :items="courtOptions"
                :placeholder="t('schedule.form.courtNone')"
                :search-input="{ placeholder: t('common.search') }"
                icon="i-lucide-land-plot"
                size="lg"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="t('schedule.form.coach')"
              name="coachMemberId"
            >
              <USelectMenu
                v-model="state.coachMemberId"
                value-key="value"
                :items="coachOptions"
                :search-input="{ placeholder: t('common.search') }"
                icon="i-lucide-user-round"
                size="lg"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField
              :label="t('schedule.form.capacityMax')"
              name="capacityMax"
              :help="t('schedule.form.capacityHelp')"
            >
              <UInput
                v-model.number="state.capacityMax"
                type="number"
                :min="1"
                size="lg"
                class="w-full"
                :placeholder="t('schedule.form.capacityNone')"
              />
            </UFormField>
            <UFormField
              :label="t('schedule.form.color')"
              name="color"
            >
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-for="preset in LESSON_COLOR_PRESETS"
                  :key="preset"
                  type="button"
                  class="size-7 rounded-full ring-2 transition-transform"
                  :style="{ backgroundColor: preset }"
                  :class="state.color.toLowerCase() === preset.toLowerCase() ? 'ring-primary scale-110' : 'ring-transparent hover:scale-105'"
                  :aria-label="preset"
                  @click="state.color = preset"
                />
              </div>
            </UFormField>
          </div>

          <UFormField name="enrollmentOpen">
            <div class="flex items-center justify-between gap-4 rounded-lg bg-elevated/40 px-4 py-3 ring-1 ring-default">
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">
                  {{ t('schedule.form.enrollmentOpen') }}
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  {{ t('schedule.form.enrollmentOpenHelp') }}
                </p>
              </div>
              <USwitch v-model="state.enrollmentOpen" />
            </div>
          </UFormField>
        </UForm>

        <!-- Structural edit: start / duration / recurrence. Re-materializes the
             future, so it's a separate, explicitly-warned action. -->
        <div class="flex flex-col gap-3 border-t border-default pt-5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-highlighted">
                {{ t('schedule.edit.scheduleTitle') }}
              </h3>
              <p class="mt-0.5 text-xs text-muted">
                {{ t('schedule.edit.scheduleHint') }}
              </p>
            </div>
            <UButton
              v-if="hasFuture && !showSchedule"
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-calendar-cog"
              :label="t('schedule.edit.changeSchedule')"
              @click="showSchedule = true"
            />
          </div>

          <p
            v-if="!hasFuture"
            class="rounded-lg bg-elevated/40 px-3 py-2 text-xs text-muted ring-1 ring-default"
          >
            {{ t('schedule.edit.noFuture') }}
          </p>

          <div
            v-else-if="showSchedule"
            class="flex flex-col gap-4 rounded-lg bg-elevated/40 p-4 ring-1 ring-default"
          >
            <p class="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
              <UIcon
                name="i-lucide-triangle-alert"
                class="mt-0.5 size-4 shrink-0"
              />
              {{ t('schedule.edit.scheduleWarning') }}
            </p>

            <UFormField :label="t('schedule.form.dtStart')">
              <AppDateTimeField v-model="schedule.dtStart" />
            </UFormField>
            <UFormField :label="t('schedule.form.duration')">
              <UInput
                v-model.number="schedule.durationMin"
                type="number"
                :min="5"
                :step="5"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('schedule.form.repeat')">
              <ScheduleRecurrencePicker
                v-model:freq="schedule.freq"
                v-model:byday="schedule.byday"
                :start-weekday="scheduleStartWeekday"
                size="md"
              />
            </UFormField>

            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :label="t('common.cancel')"
                @click="showSchedule = false"
              />
              <PressButton
                :block="false"
                size="md"
                icon="i-lucide-check"
                :loading="savingSchedule"
                :label="t('schedule.edit.applySchedule')"
                @click="saveSchedule"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="open = false"
        />
        <PressButton
          :block="false"
          size="md"
          icon="i-lucide-check"
          :loading="saving"
          :disabled="loading"
          :label="t('common.save')"
          @click="form?.submit()"
        />
      </div>
    </template>
  </USlideover>
</template>
