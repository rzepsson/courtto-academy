<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'

// The fields of one slot (recurrence rule): court, coach, start date+time,
// duration and recurrence. Shared by the create builder (repeater) and the edit
// slot editor. Models are individual (not a bound object) so the parent owns the
// state and nothing mutates a prop. `namePrefix` scopes UFormField names to an
// array index (e.g. "rules.0") when bound inside a schema-validated UForm.
const dtStart = defineModel<string>('dtStart', { required: true })
const durationMin = defineModel<number>('durationMin', { required: true })
const courtId = defineModel<string>('courtId', { required: true })
const coachMemberId = defineModel<string>('coachMemberId', { required: true })
const freq = defineModel<RecurrenceFreq>('freq', { required: true })
const byday = defineModel<string[]>('byday', { required: true })

const props = defineProps<{
  courts: CourtView[]
  coaches: { id: string, name: string }[]
  sport: string
  timezone: string
  namePrefix?: string
  size?: 'sm' | 'md' | 'lg'
  // Court picker fixed (the court cockpit) — the value stays, it just can't change.
  lockCourt?: boolean
}>()

const { t, locale } = useI18n()

// The unit noun follows the slot's sport ("Court"/"Table"), so the field reads
// right for table tennis; the lowercase form goes into the "pick a …" placeholder.
const unitLabel = computed(() => courtUnitLabel(props.sport, t))
const unitLower = computed(() => unitLabel.value.toLocaleLowerCase(locale.value))

// Courts of the group's sport; keep the current selection even if archived so the
// select never shows a blank, un-pickable value.
const courtOptions = computed(() =>
  props.courts
    .filter(c => c.sport === props.sport && (c.archivedAt === null || c.id === courtId.value))
    .map(c => ({ value: c.id, label: c.name }))
)
const coachOptions = computed(() => coachSelectOptions(props.coaches, t('schedule.form.noCoach')))

const startWeekday = computed(() => {
  const dt = DateTime.fromISO(dtStart.value, { zone: props.timezone })
  return dt.isValid ? SCHEDULE_WEEKDAYS[dt.weekday - 1]! : 'MO'
})

function fieldName(field: string): string | undefined {
  return props.namePrefix ? `${props.namePrefix}.${field}` : undefined
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField
        :label="unitLabel"
        :name="fieldName('courtId')"
        required
      >
        <USelectMenu
          v-model="courtId"
          value-key="value"
          :items="courtOptions"
          :placeholder="t('schedule.form.courtNone', { unit: unitLower })"
          :search-input="{ placeholder: t('common.search') }"
          icon="i-lucide-land-plot"
          :size="size"
          :disabled="lockCourt"
          class="w-full"
        />
      </UFormField>
      <UFormField
        :label="t('schedule.form.coach')"
        :name="fieldName('coachMemberId')"
      >
        <USelectMenu
          v-model="coachMemberId"
          value-key="value"
          :items="coachOptions"
          :search-input="{ placeholder: t('common.search') }"
          icon="i-lucide-user-round"
          :size="size"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField
      :label="t('schedule.form.dtStart')"
      :name="fieldName('dtStart')"
      required
    >
      <AppDateTimeField
        v-model="dtStart"
        :size="size"
      />
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField
        :label="t('schedule.form.duration')"
        :name="fieldName('durationMin')"
        required
      >
        <UInput
          v-model.number="durationMin"
          type="number"
          :min="5"
          :step="5"
          :size="size"
          class="w-full"
        />
      </UFormField>
      <UFormField :label="t('schedule.form.repeat')">
        <ScheduleRecurrencePicker
          v-model:freq="freq"
          v-model:byday="byday"
          :start-weekday="startWeekday"
          :size="size ?? 'md'"
        />
      </UFormField>
    </div>
  </div>
</template>
