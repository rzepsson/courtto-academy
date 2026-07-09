<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

const props = defineProps<{
  status: string
  size?: BadgeProps['size']
}>()

const { t } = useI18n()

const META: Record<string, { color: BadgeProps['color'], icon: string }> = {
  active: { color: 'success', icon: 'i-lucide-circle-check' },
  maintenance: { color: 'warning', icon: 'i-lucide-wrench' }
}

const meta = computed(() => META[props.status] ?? META.active!)
</script>

<template>
  <UBadge
    :label="t(`courts.status.${props.status}`)"
    :color="meta.color"
    :icon="meta.icon"
    variant="subtle"
    :size="props.size ?? 'sm'"
  />
</template>
