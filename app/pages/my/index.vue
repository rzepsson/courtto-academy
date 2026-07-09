<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'my-area'], layout: 'dashboard' })

const { t } = useI18n()
const { data: session } = await useAuthSession()
const { data: context } = await useAppContext()
const { switching, switchTo } = useOrgSwitch()

const active = computed(() => activeMembershipOf(context.value))
const memberships = computed(() => context.value?.memberships ?? [])

const modules = computed(() => [
  { title: t('nav.lessons'), description: t('my.modules.lessons'), icon: 'i-lucide-calendar-days' },
  { title: t('nav.payments'), description: t('my.modules.payments'), icon: 'i-lucide-credit-card' },
  { title: t('my.modules.progressTitle'), description: t('my.modules.progress'), icon: 'i-lucide-trending-up' }
])
</script>

<template>
  <UDashboardPanel id="my-home">
    <template #header>
      <UDashboardNavbar :title="t('nav.mySchools')">
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
            {{ t('my.greeting', { name: session?.user.name }) }}
          </h1>
          <p class="mt-1 text-muted">
            {{ t('my.tagline') }}
          </p>
        </MotionReveal>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Motion
            v-for="(membership, i) in memberships"
            :key="membership.id"
            :initial="{ opacity: 0, y: 12 }"
            :animate="{ opacity: 1, y: 0 }"
            :while-hover="{ y: -4 }"
            :while-press="{ scale: 0.99 }"
            :transition="{ type: 'spring', stiffness: 400, damping: 28, delay: 0.05 * (i + 1) }"
          >
            <button
              type="button"
              class="w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-primary"
              :disabled="switching"
              @click="switchTo(membership.organization.id)"
            >
              <UCard
                variant="subtle"
                :class="membership.organization.id === active?.organization.id
                  ? 'ring-2 ring-primary/50'
                  : 'transition-colors hover:bg-elevated/50'"
              >
                <div class="flex items-center gap-3">
                  <UAvatar
                    :src="membership.organization.logo ?? undefined"
                    :alt="membership.organization.name"
                    size="lg"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold text-highlighted">
                      {{ membership.organization.name }}
                    </p>
                    <RoleBadge
                      :role="membership.role"
                      class="mt-1"
                    />
                  </div>
                  <UIcon
                    v-if="membership.organization.id === active?.organization.id"
                    name="i-lucide-check-circle-2"
                    class="size-5 shrink-0 text-primary"
                  />
                </div>
              </UCard>
            </button>
          </Motion>
        </div>

        <div>
          <MotionReveal
            :delay="0.2"
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
              :delay="0.24 + 0.06 * i"
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
