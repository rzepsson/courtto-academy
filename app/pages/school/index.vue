<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const { data: session } = await useAuthSession()
const { data: context } = await useAppContext()

const active = computed(() => activeMembershipOf(context.value))

// Lazy so navigation to the overview is instant — the shell renders immediately
// and the stats/list fill in via skeletons.
const { data: members, status: membersStatus } = useLazyFetch('/api/school/members', { key: 'school:members' })
const { data: invitations, status: invitationsStatus } = useLazyFetch('/api/school/invitations', { key: 'school:invitations' })

const loading = computed(() => membersStatus.value === 'pending' || invitationsStatus.value === 'pending')

const stats = computed(() => {
  const list = members.value ?? []
  return [
    { label: t('school.overview.stats.members'), value: list.length, icon: 'i-lucide-users' },
    { label: t('school.overview.stats.coaches'), value: list.filter(m => m.role === 'coach').length, icon: 'i-lucide-clipboard-list' },
    { label: t('school.overview.stats.players'), value: list.filter(m => m.role === 'student' || m.role === 'parent').length, icon: 'i-lucide-graduation-cap' },
    { label: t('school.overview.stats.pendingInvites'), value: invitations.value?.length ?? 0, icon: 'i-lucide-mail' }
  ]
})

const recentMembers = computed(() =>
  [...(members.value ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
)

function joinedLabel(createdAt: string) {
  return formatDate(createdAt, locale.value)
}
</script>

<template>
  <UDashboardPanel id="school-overview">
    <template #header>
      <UDashboardNavbar :title="t('nav.overview')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <LocaleSwitcher />
          <ColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-8">
        <MotionReveal class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold text-highlighted">
              {{ t('school.overview.greeting', { name: session?.user.name }) }}
            </h1>
            <p class="mt-1 text-muted">
              {{ t('school.overview.tagline', { school: active?.organization.name }) }}
            </p>
          </div>
          <PressButton
            to="/school/members"
            :block="false"
            size="md"
            icon="i-lucide-user-plus"
            :label="t('school.members.invite')"
          />
        </MotionReveal>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MotionReveal
            v-for="(stat, i) in stats"
            :key="stat.icon"
            :delay="0.05 * (i + 1)"
            class="h-full"
          >
            <StatTile
              :label="stat.label"
              :value="stat.value"
              :icon="stat.icon"
              :loading="loading"
            />
          </MotionReveal>
        </div>

        <MotionReveal :delay="0.25">
          <UCard variant="subtle">
            <template #header>
              <div class="flex items-center justify-between gap-4">
                <div>
                  <h2 class="font-semibold text-highlighted">
                    {{ t('school.overview.recentMembers.title') }}
                  </h2>
                  <p class="mt-1 text-sm text-muted">
                    {{ t('school.overview.recentMembers.subtitle') }}
                  </p>
                </div>
                <UButton
                  to="/school/members"
                  color="neutral"
                  variant="ghost"
                  trailing-icon="i-lucide-arrow-right"
                  :label="t('common.viewAll')"
                />
              </div>
            </template>

            <AppListSkeleton
              v-if="loading"
              :rows="4"
            />
            <ul
              v-else-if="recentMembers.length > 0"
              class="flex flex-col divide-y divide-default"
            >
              <li
                v-for="row in recentMembers"
                :key="row.id"
                class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <UUser
                  :name="row.user.name"
                  :description="row.user.email"
                  :avatar="{ src: row.user.image ?? undefined, alt: row.user.name }"
                  size="sm"
                />
                <div class="flex items-center gap-3">
                  <span class="hidden text-xs text-dimmed sm:block">
                    {{ joinedLabel(row.createdAt) }}
                  </span>
                  <RoleBadge :role="row.role" />
                </div>
              </li>
            </ul>
            <p
              v-else
              class="py-2 text-sm text-muted"
            >
              {{ t('school.overview.recentMembers.empty') }}
            </p>
          </UCard>
        </MotionReveal>
      </div>
    </template>
  </UDashboardPanel>
</template>
