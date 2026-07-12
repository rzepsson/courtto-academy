<script setup lang="ts">
import { DateTime } from 'luxon'

// A wall-clock date + time field — the styled replacement for
// <input type="datetime-local">. Models a 'yyyy-MM-ddTHH:mm' string (the shape
// dtStart / reschedule use), split into a calendar date picker and a 15-min
// time select.
const model = defineModel<string>({ default: '' })

defineProps<{
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}>()

const { t } = useI18n()

const timeValue = computed(() => {
  const time = model.value.split('T')[1]
  return time ? time.slice(0, 5) : '12:00'
})

const datePart = computed({
  get: () => model.value.split('T')[0] ?? '',
  set: (date: string) => {
    if (date) model.value = `${date}T${timeValue.value}`
  }
})

function setTime(time: string) {
  const date = datePart.value || DateTime.now().toFormat('yyyy-MM-dd')
  model.value = `${date}T${time}`
}

const timeItems = quarterHourTimes().map(time => ({ value: time, label: time }))
</script>

<template>
  <div class="flex gap-2">
    <AppDatePicker
      v-model="datePart"
      :size="size"
      :disabled="disabled"
      block
      class="flex-1"
    />
    <USelectMenu
      :model-value="timeValue"
      value-key="value"
      :items="timeItems"
      :size="size"
      :disabled="disabled"
      icon="i-lucide-clock"
      :search-input="{ placeholder: t('common.search') }"
      class="w-32 shrink-0"
      @update:model-value="setTime"
    />
  </div>
</template>
