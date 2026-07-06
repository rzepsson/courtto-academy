<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const { data: session } = await useAuthSession()

const navItems = computed<NavigationMenuItem[][]>(() => [[
  { label: t('nav.dashboard'), icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { label: t('nav.schedule'), icon: 'i-lucide-calendar-days', badge: t('common.soon'), disabled: true },
  { label: t('nav.members'), icon: 'i-lucide-users', badge: t('common.soon'), disabled: true },
  { label: t('nav.courts'), icon: 'i-lucide-land-plot', badge: t('common.soon'), disabled: true },
  { label: t('nav.payments'), icon: 'i-lucide-credit-card', badge: t('common.soon'), disabled: true }
], [
  { label: t('nav.settings'), icon: 'i-lucide-settings', badge: t('common.soon'), disabled: true }
]])

const signingOut = ref(false)

async function onSignOut() {
  signingOut.value = true
  await authClient.signOut()
  await refreshAuthSession()
  await navigateTo('/login')
}

const userMenuItems = computed<DropdownMenuItem[][]>(() => [[
  { label: t('auth.signOut'), icon: 'i-lucide-log-out', onSelect: () => { onSignOut() } }
]])
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible>
      <template #header="{ collapsed }">
        <AppLogo
          v-if="collapsed"
          class="size-8 shrink-0"
        />
        <BrandMark
          v-else
          horizontal
        />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="navItems"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <UDropdownMenu
          :items="userMenuItems"
          :content="{ align: 'center', collisionPadding: 12 }"
          class="w-full"
        >
          <UButton
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            :loading="signingOut"
          >
            <UUser
              v-if="!collapsed"
              :name="session?.user.name"
              :description="session?.user.email"
              :avatar="{ alt: session?.user.name }"
              size="sm"
            />
            <UAvatar
              v-else
              :alt="session?.user.name"
              size="2xs"
            />
          </UButton>
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
