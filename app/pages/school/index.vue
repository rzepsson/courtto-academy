<script setup lang="ts">
import type { SchoolOverviewView } from '~/utils/overview'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const { data: session } = await useAuthSession()

const { data, status } = await useLazyFetch<{ overview: SchoolOverviewView }>('/api/school/overview', {
  key: 'school:overview'
})

const overview = computed(() => data.value?.overview ?? null)
const loading = computed(() => status.value === 'pending')

// Time-of-day greeting resolved client-side (after hydration) so SSR and the first
// client render agree on the neutral default — no hydration mismatch.
const greetingKey = ref('overview.greeting.default')
onMounted(() => {
  const hour = new Date().getHours()
  greetingKey.value = hour < 12
    ? 'overview.greeting.morning'
    : hour < 18
      ? 'overview.greeting.afternoon'
      : 'overview.greeting.evening'
})

const todayLabel = computed(() =>
  overview.value ? formatDate(overview.value.today.date, locale.value, 'full') : ''
)

const tiles = computed(() => {
  const c = overview.value?.counts
  return [
    { key: 'students', icon: 'i-lucide-graduation-cap', value: c?.students ?? 0, to: '/school/members' },
    { key: 'coaches', icon: 'i-lucide-user-round-check', value: c?.coaches ?? 0, to: '/school/members' },
    { key: 'courts', icon: 'i-lucide-land-plot', value: c?.courts ?? 0, to: '/school/courts' },
    { key: 'lessons', icon: 'i-lucide-calendar-days', value: overview.value?.week.lessonCount ?? 0, to: '/school/schedule' }
  ]
})

const showAttention = computed(() =>
  !!overview.value && (overview.value.attention.profileMissing.length > 0 || overview.value.attention.pendingInvitations > 0)
)
</script>

<template>
  <UDashboardPanel id="school-overview">
    <template #header>
      <UDashboardNavbar :title="t('nav.overview')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <!-- Greeting -->
        <MotionReveal>
          <h1 class="text-2xl font-semibold text-highlighted">
            {{ t(greetingKey, { name: session?.user.name }) }}
          </h1>
          <p class="mt-1 text-muted">
            <span
              v-if="loading"
              class="inline-block h-4 w-40 animate-pulse rounded bg-elevated align-middle"
            />
            <span v-else>{{ todayLabel }}</span>
          </p>
        </MotionReveal>

        <!-- KPI row -->
        <MotionReveal :delay="0.06">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <NuxtLink
              v-for="tile in tiles"
              :key="tile.key"
              :to="tile.to"
              class="group flex items-center gap-4 rounded-xl bg-default p-4 ring-1 ring-default transition-all hover:ring-primary/40 hover:-translate-y-0.5"
            >
              <div class="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <UIcon
                  :name="tile.icon"
                  class="size-5 text-primary"
                />
              </div>
              <div class="min-w-0">
                <p
                  v-if="loading"
                  class="h-7 w-10 animate-pulse rounded bg-elevated"
                />
                <p
                  v-else
                  class="text-2xl font-semibold tabular-nums leading-none text-highlighted"
                >
                  {{ tile.value }}
                </p>
                <p class="mt-1 truncate text-xs text-muted">
                  {{ t(`overview.tiles.${tile.key}`) }}
                </p>
              </div>
            </NuxtLink>
          </div>
        </MotionReveal>

        <!-- Loading skeleton for the panels -->
        <div
          v-if="loading"
          class="grid gap-6 lg:grid-cols-3"
        >
          <div class="flex flex-col gap-6 lg:col-span-2">
            <USkeleton class="h-72 w-full" />
            <USkeleton class="h-72 w-full" />
          </div>
          <USkeleton class="h-96 w-full" />
        </div>

        <div
          v-else-if="overview"
          class="grid gap-6 lg:grid-cols-3"
        >
          <!-- Main column -->
          <div class="flex flex-col gap-6 lg:col-span-2">
            <MotionReveal :delay="0.12">
              <SchoolOverviewTodaySchedule
                :sessions="overview.today.sessions"
                :timezone="overview.timezone"
                :locale="locale"
              />
            </MotionReveal>
            <MotionReveal :delay="0.16">
              <SchoolOverviewOccupancyHeatmap
                :week="overview.week"
                :locale="locale"
              />
            </MotionReveal>
          </div>

          <!-- Side rail -->
          <div class="flex flex-col gap-6">
            <MotionReveal
              v-if="showAttention"
              :delay="0.2"
              class="flex flex-col gap-6"
            >
              <SchoolSetupChecklist
                v-if="overview.attention.profileMissing.length"
                :missing="overview.attention.profileMissing"
                @navigate="navigateTo('/school/settings')"
              />
              <NuxtLink
                v-if="overview.attention.pendingInvitations > 0"
                to="/school/members"
                class="group flex items-center gap-3 rounded-xl bg-default p-4 ring-1 ring-default transition-all hover:ring-primary/40"
              >
                <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
                  <UIcon
                    name="i-lucide-mail-plus"
                    class="size-5 text-warning"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-highlighted">
                    {{ t('overview.pendingInvites.title', { count: overview.attention.pendingInvitations }) }}
                  </p>
                  <p class="truncate text-xs text-muted">
                    {{ t('overview.pendingInvites.subtitle') }}
                  </p>
                </div>
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-4 shrink-0 text-dimmed"
                />
              </NuxtLink>
            </MotionReveal>

            <MotionReveal :delay="0.24">
              <SchoolOverviewRecentActivity
                :entries="overview.activity"
                :locale="locale"
              />
            </MotionReveal>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
