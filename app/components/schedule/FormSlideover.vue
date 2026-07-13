<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'

// Create a lesson group: the school-side builder. The group's WHAT (title, type,
// sport, capacity, colour, enrolment) is set once; its WHEN/WHERE is one or more
// "slots" (recurrence rules), so a group can meet e.g. Wed 15:00 on court 1 and
// Thu 13:00 on court 2. Binds the shared scheduleCreateFormSchema the server also
// validates the POST body against.
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  courts: CourtView[]
  coaches: { id: string, name: string }[]
  allowedSports: string[]
  timezone: string
  // `sport` lets a caller (e.g. the court cockpit) open the form on a specific
  // court whose discipline isn't the first offered — so its court prefill isn't
  // dropped when the default sport wouldn't include it. `startLocal` is optional:
  // omitted (e.g. an "Add lesson" button, not a clicked slot) → the default start.
  prefill?: { startLocal?: string, courtId: string | null, sport?: string } | null
  // The court cockpit locks the discipline + court to the one you're on, so a
  // lesson can't be created against the wrong court by accident.
  lockCourt?: boolean
}>()

const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const form = useTemplateRef('form')

interface RuleDraft {
  dtStart: string
  durationMin: number
  courtId: string
  coachMemberId: string
  freq: RecurrenceFreq
  byday: string[]
}

const state = reactive({
  type: 'group',
  sport: 'tennis',
  title: '',
  color: DEFAULT_LESSON_COLOR,
  capacityMax: null as number | null,
  capacityMin: null as number | null,
  enrollmentOpen: true,
  rules: [] as RuleDraft[]
})
const saving = ref(false)

function defaultStart(): string {
  return localDateTimeStamp(DateTime.now().setZone(props.timezone).plus({ days: 1 }).set({ hour: 17, minute: 0, second: 0 }))
}

// A court of the current sport (prefill first, else the first available).
function defaultCourtId(prefillCourtId?: string | null): string {
  const forSport = props.courts.filter(c => c.sport === state.sport && c.archivedAt === null)
  return prefillCourtId && forSport.some(c => c.id === prefillCourtId) ? prefillCourtId : (forSport[0]?.id ?? '')
}

function newRule(prefill?: { startLocal?: string, courtId: string | null } | null): RuleDraft {
  return {
    dtStart: prefill?.startLocal || defaultStart(),
    durationMin: 60,
    courtId: defaultCourtId(prefill?.courtId),
    coachMemberId: NO_COACH_VALUE,
    freq: 'none',
    byday: []
  }
}

function initForm() {
  state.type = 'group'
  const prefillSport = props.prefill?.sport
  state.sport = prefillSport && props.allowedSports.includes(prefillSport)
    ? prefillSport
    : props.allowedSports.includes(state.sport) ? state.sport : (props.allowedSports[0] ?? 'tennis')
  state.title = ''
  state.color = DEFAULT_LESSON_COLOR
  state.capacityMax = null
  state.capacityMin = null
  state.enrollmentOpen = true
  state.rules = [newRule(props.prefill)]
}

watch(open, (value) => {
  if (value) initForm()
})

function addRule() {
  // A new slot inherits the previous slot's court (a group usually meets on the
  // same court); the caller can still change it unless the court is locked.
  const previous = state.rules[state.rules.length - 1]
  state.rules.push(newRule(previous ? { courtId: previous.courtId } : undefined))
}
function removeRule(index: number) {
  if (state.rules.length > 1) state.rules.splice(index, 1)
}

// Courts of the chosen sport (shared by every slot). When the sport changes, drop
// any slot's court that no longer matches.
const courtOptions = computed(() =>
  props.courts.filter(c => c.sport === state.sport && c.archivedAt === null).map(c => ({ value: c.id, label: c.name }))
)
watch(() => state.sport, () => {
  for (const rule of state.rules) {
    if (!courtOptions.value.some(c => c.value === rule.courtId)) {
      rule.courtId = courtOptions.value[0]?.value ?? ''
    }
  }
})

const sportOptions = computed(() =>
  props.allowedSports.filter(isCourtSport).map(s => ({ value: s as string, label: t(`school.settings.sports.${s}`) }))
)
const typeOptions = computed(() => lessonTypeOptions(t))
const formSchema = computed(() => scheduleCreateFormSchema(t))

function weekdayOf(dtStart: string): string {
  const dt = DateTime.fromISO(dtStart, { zone: props.timezone })
  return dt.isValid ? SCHEDULE_WEEKDAYS[dt.weekday - 1]! : 'MO'
}

async function onSubmit() {
  saving.value = true
  const body: Record<string, unknown> = {
    type: state.type,
    sport: state.sport,
    title: state.title.trim(),
    color: state.color,
    enrollmentOpen: state.enrollmentOpen,
    rules: state.rules.map(rule => ({
      dtStart: rule.dtStart,
      durationMin: rule.durationMin,
      courtId: rule.courtId,
      coachMemberId: rule.coachMemberId !== NO_COACH_VALUE ? rule.coachMemberId : undefined,
      rrule: buildRRule(rule.freq, rule.byday, weekdayOf(rule.dtStart)) ?? undefined
    }))
  }
  if (typeof state.capacityMax === 'number' && Number.isFinite(state.capacityMax)) body.capacityMax = state.capacityMax

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
              :disabled="lockCourt"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Slots (recurrence rules) -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-highlighted">
                {{ t('schedule.form.slots') }}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ t('schedule.form.slotsHelp') }}
              </p>
            </div>
          </div>

          <div
            v-for="(rule, i) in state.rules"
            :key="i"
            class="flex flex-col gap-4 rounded-lg bg-elevated/40 p-4 ring-1 ring-default"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wide text-dimmed">
                {{ t('schedule.form.slot', { n: i + 1 }) }}
              </span>
              <UButton
                v-if="state.rules.length > 1"
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-x"
                :aria-label="t('schedule.form.removeSlot')"
                @click="removeRule(i)"
              />
            </div>

            <ScheduleRuleFields
              v-model:dt-start="rule.dtStart"
              v-model:duration-min="rule.durationMin"
              v-model:court-id="rule.courtId"
              v-model:coach-member-id="rule.coachMemberId"
              v-model:freq="rule.freq"
              v-model:byday="rule.byday"
              :courts="courts"
              :coaches="coaches"
              :sport="state.sport"
              :timezone="timezone"
              :lock-court="lockCourt"
              :name-prefix="`rules.${i}`"
            />
          </div>

          <UButton
            color="neutral"
            variant="subtle"
            size="sm"
            icon="i-lucide-plus"
            :label="t('schedule.form.addSlot')"
            class="self-start"
            @click="addRule"
          />
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
