<script setup lang="ts">
import { DateTime } from 'luxon'

// Calendar navigation: prev/next/today + a day/week toggle + the current label.
const view = defineModel<'day' | 'week'>('view', { required: true })
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

function today() {
  anchorAt.value = DateTime.now().setZone(props.timezone).toISO()!
}
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
      <p class="text-sm font-medium text-highlighted">
        {{ label }}
      </p>
    </div>

    <UFieldGroup>
      <UButton
        :color="view === 'day' ? 'primary' : 'neutral'"
        :variant="view === 'day' ? 'solid' : 'subtle'"
        :label="t('schedule.calendar.day')"
        @click="view = 'day'"
      />
      <UButton
        :color="view === 'week' ? 'primary' : 'neutral'"
        :variant="view === 'week' ? 'solid' : 'subtle'"
        :label="t('schedule.calendar.week')"
        @click="view = 'week'"
      />
    </UFieldGroup>
  </div>
</template>
