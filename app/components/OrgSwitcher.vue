<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{ collapsed?: boolean }>()

const { t } = useI18n()
const { data: context } = await useAppContext()
const { switching, switchTo } = useOrgSwitch()

const active = computed(() => activeMembershipOf(context.value))

const items = computed<DropdownMenuItem[][]>(() => [
  (context.value?.memberships ?? []).map(membership => ({
    label: membership.organization.name,
    type: 'checkbox' as const,
    checked: membership.organization.id === active.value?.organization.id,
    onSelect: () => {
      switchTo(membership.organization.id)
    }
  })),
  [{
    label: t('orgSwitcher.createSchool'),
    icon: 'i-lucide-plus',
    to: '/onboarding'
  }]
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'start', collisionPadding: 12 }"
    :ui="{ content: 'w-56' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      :loading="switching"
      :aria-label="t('orgSwitcher.label')"
    >
      <UAvatar
        :src="active?.organization.logo ?? undefined"
        :alt="active?.organization.name"
        size="2xs"
      />
      <template v-if="!collapsed">
        <span class="truncate font-medium text-highlighted">
          {{ active?.organization.name }}
        </span>
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="ms-auto size-4 shrink-0 text-dimmed"
        />
      </template>
    </UButton>
  </UDropdownMenu>
</template>
