<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { t } = useI18n()
const { data: session } = await useAuthSession()

const modules = computed(() => [
  { title: t('nav.schedule'), description: t('dashboard.modules.schedule'), icon: 'i-lucide-calendar-days' },
  { title: t('nav.members'), description: t('dashboard.modules.members'), icon: 'i-lucide-users' },
  { title: t('nav.courts'), description: t('dashboard.modules.courts'), icon: 'i-lucide-land-plot' },
  { title: t('nav.payments'), description: t('dashboard.modules.payments'), icon: 'i-lucide-credit-card' }
])
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="t('nav.dashboard')">
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
        <div>
          <h1 class="text-2xl font-semibold text-highlighted">
            {{ t('dashboard.greeting', { name: session?.user.name }) }}
          </h1>
          <p class="mt-1 text-muted">
            {{ t('dashboard.tagline') }}
          </p>
        </div>

        <UCard variant="subtle">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              {{ t('dashboard.account.title') }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{ t('dashboard.account.subtitle') }}
            </p>
          </template>

          <dl class="flex flex-col gap-3 text-sm">
            <div class="flex items-center justify-between gap-4">
              <dt class="text-muted">
                {{ t('auth.fields.name') }}
              </dt>
              <dd class="font-medium text-highlighted">
                {{ session?.user.name }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4">
              <dt class="text-muted">
                {{ t('auth.fields.email') }}
              </dt>
              <dd class="font-medium text-highlighted">
                {{ session?.user.email }}
              </dd>
            </div>
          </dl>
        </UCard>

        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted">
              {{ t('dashboard.comingSoon') }}
            </h2>
            <UBadge
              :label="t('common.soon')"
              color="primary"
              variant="subtle"
              size="sm"
            />
          </div>
          <UPageGrid class="mt-4 lg:grid-cols-4">
            <UPageCard
              v-for="module in modules"
              :key="module.icon"
              :title="module.title"
              :description="module.description"
              :icon="module.icon"
              variant="subtle"
            />
          </UPageGrid>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
