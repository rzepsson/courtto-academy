<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { roleArea } from '~~/shared/permissions'

const { t } = useI18n()
const { data: session } = await useAuthSession()
const { data: context } = await useAppContext()

const active = computed(() => activeMembershipOf(context.value))

const navItems = computed<NavigationMenuItem[][]>(() => {
  const soon = (label: string, icon: string): NavigationMenuItem =>
    ({ label, icon, badge: t('common.soon'), disabled: true })

  switch (active.value ? roleArea(active.value.role) : undefined) {
    case 'school':
      return [[
        { label: t('nav.overview'), icon: 'i-lucide-layout-dashboard', to: '/school' },
        { label: t('nav.members'), icon: 'i-lucide-users', to: '/school/members' },
        { label: t('nav.courts'), icon: 'i-lucide-land-plot', to: '/school/courts' },
        { label: t('nav.schedule'), icon: 'i-lucide-calendar-days', to: '/school/schedule' },
        soon(t('nav.payments'), 'i-lucide-credit-card')
      ], [
        { label: t('nav.activity'), icon: 'i-lucide-history', to: '/school/audit' },
        { label: t('nav.settings'), icon: 'i-lucide-settings', to: '/school/settings' }
      ]]
    case 'coach':
      return [[
        { label: t('nav.overview'), icon: 'i-lucide-layout-dashboard', to: '/coach' },
        { label: t('nav.schedule'), icon: 'i-lucide-calendar-days', to: '/coach/schedule' },
        soon(t('nav.groups'), 'i-lucide-users')
      ]]
    default:
      return [[
        { label: t('nav.mySchools'), icon: 'i-lucide-home', to: '/my' },
        { label: t('nav.lessons'), icon: 'i-lucide-calendar-days', to: '/my/lessons' },
        soon(t('nav.payments'), 'i-lucide-credit-card')
      ]]
  }
})

const { signingOut, signOut } = useSignOut()

const userMenuItems = computed<DropdownMenuItem[][]>(() => [[
  { label: t('auth.signOut'), icon: 'i-lucide-log-out', onSelect: () => { signOut() } }
]])
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible>
      <template #header="{ collapsed }">
        <BrandMark
          horizontal
          :collapsed="collapsed"
        />
      </template>

      <template #default="{ collapsed }">
        <MotionReveal :y="6">
          <OrgSwitcher :collapsed="collapsed" />
        </MotionReveal>

        <MotionReveal
          :y="6"
          :delay="0.08"
        >
          <UNavigationMenu
            :collapsed="collapsed"
            :items="navItems"
            orientation="vertical"
          />
        </MotionReveal>
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
            :loading="signingOut"
            class="transition-[padding] duration-200 ease-in-out"
            :class="collapsed ? 'p-1' : 'px-2.5 py-1.5'"
          >
            <div class="flex h-10 w-full items-center gap-2.5">
              <Icon
                name="i-lucide-user"
                class="h-5 w-5 shrink-0"
              />
              <SidebarReveal :collapsed="collapsed">
                <div class="max-w-40 text-left">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ session?.user.name }}
                  </p>
                  <p class="truncate text-xs text-muted">
                    {{ session?.user.email }}
                  </p>
                </div>
              </SidebarReveal>
            </div>
          </UButton>
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
