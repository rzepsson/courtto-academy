<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'

// Create a lesson: the school-side builder. Binds the same shared Zod schema the
// server validates (scheduleFormSchema). A compact recurrence control compiles a
// supported RRULE (none / daily / weekly-by-weekday / monthly).
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  courts: CourtView[]
  coaches: { id: string, name: string }[]
  allowedSports: string[]
  timezone: string
  prefill?: { startLocal: string, courtId: string | null } | null
}>()

const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const form = useTemplateRef('form')

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

const state = reactive({
  type: 'group',
  sport: 'tennis',
  title: '',
  defaultCourtId: '',
  coachMemberId: NO_COACH_VALUE,
  dtStart: '',
  durationMin: 60,
  color: DEFAULT_LESSON_COLOR,
  capacityMax: null as number | null,
  capacityMin: null as number | null,
  enrollmentOpen: true,
  freq: 'none' as 'none' | 'daily' | 'weekly' | 'monthly',
  byday: [] as string[]
})
const saving = ref(false)

function defaultStart(): string {
  return localDateTimeStamp(DateTime.now().setZone(props.timezone).plus({ days: 1 }).set({ hour: 17, minute: 0, second: 0 }))
}

function initForm() {
  const sport = props.allowedSports.includes(state.sport) ? state.sport : (props.allowedSports[0] ?? 'tennis')
  state.type = 'group'
  state.sport = sport
  state.title = ''
  state.dtStart = props.prefill?.startLocal ?? defaultStart()
  state.durationMin = 60
  state.color = DEFAULT_LESSON_COLOR
  state.capacityMax = null
  state.capacityMin = null
  state.enrollmentOpen = true
  state.coachMemberId = NO_COACH_VALUE
  state.freq = 'none'
  state.byday = []
  // Prefer the prefilled court, else the first offered-sport court.
  const forSport = props.courts.filter(c => c.sport === sport && c.archivedAt === null)
  state.defaultCourtId = props.prefill?.courtId && forSport.some(c => c.id === props.prefill?.courtId)
    ? props.prefill.courtId
    : (forSport[0]?.id ?? '')
}

watch(open, (value) => {
  if (value) initForm()
})

// A court must match the lesson sport; drop the selection when it no longer does.
const courtOptions = computed(() =>
  props.courts.filter(c => c.sport === state.sport && c.archivedAt === null).map(c => ({ value: c.id, label: c.name }))
)
watch(() => state.sport, () => {
  if (!courtOptions.value.some(c => c.value === state.defaultCourtId)) {
    state.defaultCourtId = courtOptions.value[0]?.value ?? ''
  }
})

const coachOptions = computed(() => coachSelectOptions(props.coaches, t('schedule.form.noCoach')))

const sportOptions = computed(() =>
  props.allowedSports.filter(isCourtSport).map(s => ({ value: s as string, label: t(`school.settings.sports.${s}`) }))
)
const typeOptions = computed(() => lessonTypeOptions(t))
const freqOptions = computed(() => [
  { value: 'none', label: t('schedule.form.freq.none') },
  { value: 'daily', label: t('schedule.form.freq.daily') },
  { value: 'weekly', label: t('schedule.form.freq.weekly') },
  { value: 'monthly', label: t('schedule.form.freq.monthly') }
])

const startWeekday = computed(() => {
  const dt = DateTime.fromISO(state.dtStart, { zone: props.timezone })
  return dt.isValid ? WEEKDAYS[dt.weekday - 1]! : 'MO'
})

const rrule = computed<string | null>(() => {
  switch (state.freq) {
    case 'daily': return 'FREQ=DAILY'
    case 'monthly': return 'FREQ=MONTHLY'
    case 'weekly': {
      const days = state.byday.length ? state.byday : [startWeekday.value]
      return `FREQ=WEEKLY;BYDAY=${days.join(',')}`
    }
    default: return null
  }
})

const formSchema = computed(() => scheduleFormSchema(t))

function toggleDay(day: string) {
  state.byday = state.byday.includes(day) ? state.byday.filter(d => d !== day) : [...state.byday, day]
}

async function onSubmit() {
  saving.value = true
  const body: Record<string, unknown> = {
    type: state.type,
    sport: state.sport,
    title: state.title.trim(),
    defaultCourtId: state.defaultCourtId,
    dtStart: state.dtStart,
    durationMin: state.durationMin,
    color: state.color,
    enrollmentOpen: state.enrollmentOpen
  }
  if (state.coachMemberId && state.coachMemberId !== NO_COACH_VALUE) body.coachMemberId = state.coachMemberId
  if (rrule.value) body.rrule = rrule.value
  // A cleared number input yields '' (not null), so guard on the numeric type.
  if (typeof state.capacityMax === 'number' && Number.isFinite(state.capacityMax)) body.capacityMax = state.capacityMax
  if (typeof state.capacityMin === 'number' && Number.isFinite(state.capacityMin)) body.capacityMin = state.capacityMin

  try {
    await $fetch('/api/school/schedule', { method: 'POST', body })
    toast.add({ title: t('schedule.form.created'), color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('schedule.form.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('schedule.form.createTitle')"
    :description="t('schedule.form.subtitle')"
    :ui="{ content: 'max-w-xl w-full' }"
  >
    <template #body>
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
            autofocus
          />
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            :label="t('schedule.form.type')"
            name="type"
          >
            <USelect
              v-model="state.type"
              value-key="value"
              :items="typeOptions"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t('schedule.form.sport')"
            name="sport"
          >
            <USelect
              v-model="state.sport"
              value-key="value"
              :items="sportOptions"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            :label="t('schedule.form.court')"
            name="defaultCourtId"
            required
          >
            <USelect
              v-model="state.defaultCourtId"
              value-key="value"
              :items="courtOptions"
              :placeholder="t('schedule.form.courtNone')"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t('schedule.form.coach')"
            name="coachMemberId"
          >
            <USelect
              v-model="state.coachMemberId"
              value-key="value"
              :items="coachOptions"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            :label="t('schedule.form.dtStart')"
            name="dtStart"
            required
          >
            <UInput
              v-model="state.dtStart"
              type="datetime-local"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t('schedule.form.duration')"
            name="durationMin"
            required
          >
            <UInput
              v-model.number="state.durationMin"
              type="number"
              :min="5"
              :step="5"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Recurrence -->
        <UFormField
          :label="t('schedule.form.repeat')"
          name="freq"
        >
          <USelect
            v-model="state.freq"
            value-key="value"
            :items="freqOptions"
            size="lg"
            class="w-full"
          />
        </UFormField>
        <div
          v-if="state.freq === 'weekly'"
          class="flex flex-wrap gap-1.5"
        >
          <button
            v-for="day in WEEKDAYS"
            :key="day"
            type="button"
            class="rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors"
            :class="(state.byday.length ? state.byday.includes(day) : day === startWeekday)
              ? 'bg-primary text-inverted ring-primary'
              : 'bg-default text-muted ring-default hover:text-default hover:ring-inverted/20'"
            @click="toggleDay(day)"
          >
            {{ t(`schedule.weekdays.${day}`) }}
          </button>
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
          :label="t('schedule.form.create')"
          @click="form?.submit()"
        />
      </div>
    </template>
  </USlideover>
</template>
