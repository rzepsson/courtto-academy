<script setup lang="ts">
import { DateTime } from 'luxon'

// Calendar navigation: prev/next/today + a day/week/agenda toggle + the current
// label. Agenda navigates by week, like the week grid.
const view = defineModel<ScheduleView>('view', { required: true })
const anchorAt = defineModel<string>('anchorAt', { required: true })

const props = defineProps<{ timezone: string }>()

const { t, locale } = useI18n()

const anchor = computed(() => DateTime.fromISO(anchorAt.value, { zone: props.timezone }).setLocale(locale.value))

const label = computed(() => {
  if (view.value === 'day') return anchor.value.toFormat('cccc, d LLLL yyyy')
  const start = anchor.value.startOf('week')
  const end = start.plus({ days: 6 })
  return `${start.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`
})

function shift(direction: number) {
  const base = DateTime.fromISO(anchorAt.value, { zone: props.timezone })
  const next = view.value === 'day' ? base.plus({ days: direction }) : base.plus({ weeks: direction })
  anchorAt.value = next.toISO()!
}

const viewOptions = [
  { value: 'day' as const, label: 'schedule.calendar.day' },
  { value: 'week' as const, label: 'schedule.calendar.week' },
  { value: 'agenda' as const, label: 'schedule.calendar.agenda' }
]

function today() {
  anchorAt.value = DateTime.now().setZone(props.timezone).toISO()!
}

// The label doubles as a date picker: picking a day jumps the anchor there (in
// day view that day; in week/agenda the week containing it).
const anchorDate = computed({
  get: () => DateTime.fromISO(anchorAt.value, { zone: props.timezone }).toFormat('yyyy-MM-dd'),
  set: (date: string) => {
    const dt = DateTime.fromISO(date, { zone: props.timezone })
    if (dt.isValid) anchorAt.value = dt.toISO()!
  }
})
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <UFieldGroup>
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="subtle"
          :aria-label="t('schedule.calendar.previous')"
          @click="shift(-1)"
        />
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="subtle"
          :aria-label="t('schedule.calendar.next')"
          @click="shift(1)"
        />
      </UFieldGroup>
      <UButton
        color="neutral"
        variant="subtle"
        :label="t('schedule.calendar.today')"
        @click="today"
      />
      <AppDatePicker
        v-model="anchorDate"
        :label="label"
        variant="ghost"
        icon="i-lucide-calendar"
      />
    </div>

    <UFieldGroup>
      <UButton
        v-for="option in viewOptions"
        :key="option.value"
        :color="view === option.value ? 'primary' : 'neutral'"
        :variant="view === option.value ? 'solid' : 'subtle'"
        :label="t(option.label)"
        @click="view = option.value"
      />
    </UFieldGroup>
  </div>
</template>
