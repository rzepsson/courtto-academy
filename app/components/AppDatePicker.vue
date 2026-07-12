<script setup lang="ts">
import { parseDate, type DateValue } from '@internationalized/date'
import { DateTime } from 'luxon'

// A localized, keyboard-accessible date picker (Nuxt UI popover + calendar) —
// the styled replacement for a raw <input type="date">. Models a plain
// 'yyyy-MM-dd' string so callers never touch @internationalized/date.
const model = defineModel<string>({ default: '' })

const props = defineProps<{
  placeholder?: string
  label?: string // overrides the formatted date on the trigger (e.g. a week range)
  size?: 'sm' | 'md' | 'lg'
  variant?: 'solid' | 'outline' | 'subtle' | 'soft' | 'ghost'
  icon?: string
  disabled?: boolean
  block?: boolean
}>()

const { locale } = useI18n()
const open = ref(false)

const calendarValue = computed({
  get(): DateValue | undefined {
    if (!model.value) return undefined
    try {
      return parseDate(model.value)
    } catch {
      return undefined
    }
  },
  set(value: DateValue | undefined) {
    if (!value) return
    model.value = value.toString()
    open.value = false
  }
})

const display = computed(() => {
  if (props.label) return props.label
  if (!model.value) return ''
  const dt = DateTime.fromISO(model.value)
  return dt.isValid ? dt.setLocale(locale.value).toFormat('d LLL yyyy') : model.value
})
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      color="neutral"
      :variant="variant ?? 'outline'"
      :size="size"
      :disabled="disabled"
      :block="block"
      :icon="icon ?? 'i-lucide-calendar'"
      class="justify-start font-normal"
    >
      <span
        class="truncate"
        :class="!display && 'text-dimmed'"
      >{{ display || placeholder }}</span>
    </UButton>

    <template #content>
      <UCalendar
        v-model="calendarValue"
        :week-starts-on="1"
        :locale="locale"
        class="p-2"
      />
    </template>
  </UPopover>
</template>
