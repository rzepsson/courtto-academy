<script setup lang="ts">
// The compact recurrence control shared by the create form and the edit panel:
// a frequency select plus, for weekly, a weekday toggle. The parent compiles the
// RRULE from these via `buildRRule`. Weekly with no day chosen highlights the
// start's weekday (the effective default).
const freq = defineModel<RecurrenceFreq>('freq', { required: true })
const byday = defineModel<string[]>('byday', { required: true })

const props = defineProps<{
  startWeekday: string
  size?: 'sm' | 'md' | 'lg'
}>()

const { t } = useI18n()

const freqOptions = computed(() => [
  { value: 'none', label: t('schedule.form.freq.none') },
  { value: 'daily', label: t('schedule.form.freq.daily') },
  { value: 'weekly', label: t('schedule.form.freq.weekly') },
  { value: 'monthly', label: t('schedule.form.freq.monthly') }
])

function toggleDay(day: string) {
  byday.value = byday.value.includes(day) ? byday.value.filter(d => d !== day) : [...byday.value, day]
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <USelect
      v-model="freq"
      value-key="value"
      :items="freqOptions"
      :size="props.size ?? 'lg'"
      class="w-full"
    />
    <div
      v-if="freq === 'weekly'"
      class="flex flex-wrap gap-1.5"
    >
      <button
        v-for="day in SCHEDULE_WEEKDAYS"
        :key="day"
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors"
        :class="(byday.length ? byday.includes(day) : day === startWeekday)
          ? 'bg-primary text-inverted ring-primary'
          : 'bg-default text-muted ring-default hover:text-default hover:ring-inverted/20'"
        @click="toggleDay(day)"
      >
        {{ t(`schedule.weekdays.${day}`) }}
      </button>
    </div>
  </div>
</template>
