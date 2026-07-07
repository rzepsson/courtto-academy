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
      :loading="switching"
      :aria-label="t('orgSwitcher.label')"
      class="group transition-[padding] duration-200 ease-in-out"
      :class="collapsed ? 'p-1' : 'px-2.5 py-1.5'"
    >
      <div class="flex w-full items-center gap-2">
        <UAvatar
          :src="active?.organization.logo ?? undefined"
          :alt="active?.organization.name"
          size="2xs"
          class="shrink-0 transition-transform duration-200 group-hover:scale-105"
        />
        <SidebarReveal :collapsed="collapsed">
          <span class="flex items-center gap-1">
            <span class="max-w-32 truncate font-medium text-highlighted">
              {{ active?.organization.name }}
            </span>
            <UIcon
              name="i-lucide-chevrons-up-down"
              class="size-4 shrink-0 text-dimmed transition-colors duration-200 group-hover:text-default"
            />
          </span>
        </SidebarReveal>
      </div>
    </UButton>
  </UDropdownMenu>
</template>
