<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'
import type { OrgRole } from '~~/shared/permissions'

// Hoisted to module scope: this map is static, so it's allocated once rather
// than per RoleBadge instance (there's one per row in every member list).
const META: Record<OrgRole, { color: BadgeProps['color'], icon: string }> = {
  owner: { color: 'primary', icon: 'i-lucide-crown' },
  admin: { color: 'secondary', icon: 'i-lucide-shield-check' },
  coach: { color: 'info', icon: 'i-lucide-clipboard-list' },
  student: { color: 'neutral', icon: 'i-lucide-graduation-cap' }
}

const props = defineProps<{
  role: OrgRole
  size?: BadgeProps['size']
}>()

const { t } = useI18n()

const meta = computed(() => META[props.role] ?? META.student)
</script>

<template>
  <UBadge
    :label="t(`roles.${props.role}`)"
    :color="meta.color"
    :icon="meta.icon"
    variant="subtle"
    :size="props.size ?? 'sm'"
  />
</template>
