<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const { data: session } = await useAuthSession()
const { data: context } = await useAppContext()

const active = computed(() => activeMembershipOf(context.value))

const joinedLabel = computed(() =>
  active.value ? formatDate(active.value.createdAt, locale.value, 'long') : ''
)

const modules = computed(() => [
  { title: t('nav.schedule'), description: t('school.modules.schedule'), icon: 'i-lucide-calendar-days' },
  { title: t('nav.payments'), description: t('school.modules.payments'), icon: 'i-lucide-credit-card' }
])
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
      <div class="flex flex-col gap-8">
        <MotionReveal>
          <h1 class="text-2xl font-semibold text-highlighted">
            {{ t('school.overview.greeting', { name: session?.user.name }) }}
          </h1>
          <p class="mt-1 text-muted">
            {{ t('school.overview.tagline', { school: active?.organization.name }) }}
          </p>
        </MotionReveal>

        <MotionReveal :delay="0.08">
          <UCard variant="subtle">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <UAvatar
                  :src="active?.organization.logo ?? undefined"
                  :alt="active?.organization.name"
                  size="lg"
                />
                <div>
                  <p class="font-semibold text-highlighted">
                    {{ active?.organization.name }}
                  </p>
                  <p class="mt-0.5 text-sm text-muted">
                    {{ t('school.overview.memberSince', { date: joinedLabel }) }}
                  </p>
                </div>
              </div>
              <RoleBadge
                v-if="active"
                :role="active.role"
                size="md"
              />
            </div>
          </UCard>
        </MotionReveal>

        <div>
          <MotionReveal
            :delay="0.16"
            class="flex items-center gap-2"
          >
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted">
              {{ t('dashboard.comingSoon') }}
            </h2>
            <UBadge
              :label="t('common.soon')"
              color="primary"
              variant="subtle"
              size="sm"
            />
          </MotionReveal>
          <UPageGrid class="mt-4 lg:grid-cols-3">
            <MotionReveal
              v-for="(module, i) in modules"
              :key="module.icon"
              :delay="0.2 + 0.06 * i"
              class="h-full"
            >
              <UPageCard
                :title="module.title"
                :description="module.description"
                :icon="module.icon"
                variant="subtle"
                class="h-full"
              />
            </MotionReveal>
          </UPageGrid>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
