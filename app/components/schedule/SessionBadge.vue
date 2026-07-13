<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

// Session lifecycle badge — map-driven like RoleBadge.
const props = defineProps<{
  status: string
  size?: BadgeProps['size']
}>()

const { t } = useI18n()

const META: Record<string, { color: BadgeProps['color'], icon: string }> = {
  scheduled: { color: 'primary', icon: 'i-lucide-calendar-check' },
  rescheduled: { color: 'warning', icon: 'i-lucide-calendar-clock' },
  completed: { color: 'neutral', icon: 'i-lucide-check' },
  cancelled: { color: 'error', icon: 'i-lucide-calendar-x' }
}

const meta = computed(() => META[props.status] ?? { color: 'neutral' as const, icon: 'i-lucide-calendar' })
</script>

<template>
  <UBadge
    :color="meta.color"
    :icon="meta.icon"
    :label="t(`schedule.sessionStatus.${status}`)"
    variant="subtle"
    :size="size"
  />
</template>
