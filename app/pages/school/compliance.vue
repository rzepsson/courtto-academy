<script setup lang="ts">
import type { ComplianceReportDto } from '~~/server/database/types'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t } = useI18n()

const { data, status } = await useLazyFetch<{ report: ComplianceReportDto }>('/api/school/compliance', {
  key: 'school:compliance'
})

const report = computed(() => data.value?.report ?? null)
const loading = computed(() => status.value === 'pending')

type GapFilter = 'all' | 'guardian' | 'consent'
const filter = ref<GapFilter>('all')
const search = ref('')

const visibleRows = computed(() => {
  const rows = report.value?.rows ?? []
  const query = search.value.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter.value === 'guardian' && !row.missingGuardian) return false
    if (filter.value === 'consent' && !row.missingImageConsent) return false
    if (query && !(row.user.name.toLowerCase().includes(query) || row.user.email.toLowerCase().includes(query))) {
      return false
    }
    return true
  })
})

const allClear = computed(() => !!report.value && report.value.summary.withGaps === 0)

const tiles = computed(() => {
  const s = report.value?.summary
  return [
    { key: 'students', icon: 'i-lucide-users', value: s?.studentsConsidered ?? 0, tone: 'neutral', filter: null as GapFilter | null },
    { key: 'guardian', icon: 'i-lucide-user-x', value: s?.missingGuardian ?? 0, tone: 'error', filter: 'guardian' as GapFilter | null },
    { key: 'consent', icon: 'i-lucide-scan-face', value: s?.missingImageConsent ?? 0, tone: 'warning', filter: 'consent' as GapFilter | null },
    { key: 'withGaps', icon: 'i-lucide-shield-alert', value: s?.withGaps ?? 0, tone: 'neutral', filter: 'all' as GapFilter | null }
  ]
})

const toneClass: Record<string, string> = {
  neutral: 'bg-elevated text-dimmed',
  error: 'bg-error/10 text-error',
  warning: 'bg-warning/10 text-warning'
}
</script>

<template>
  <UDashboardPanel id="school-compliance">
    <template #header>
      <UDashboardNavbar :title="t('compliance.title')">
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
        <MotionReveal>
          <h1 class="text-2xl font-semibold text-highlighted">
            {{ t('compliance.title') }}
          </h1>
          <p class="mt-1 max-w-2xl text-muted">
            {{ t('compliance.subtitle') }}
          </p>
        </MotionReveal>

        <!-- Summary tiles -->
        <MotionReveal :delay="0.06">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <component
              :is="tile.filter !== null ? 'button' : 'div'"
              v-for="tile in tiles"
              :key="tile.key"
              type="button"
              class="flex items-center gap-4 rounded-xl bg-default p-4 text-left ring-1 ring-default transition-all"
              :class="[
                tile.filter !== null ? 'hover:ring-primary/40' : '',
                tile.filter !== null && filter === tile.filter ? 'ring-primary' : ''
              ]"
              @click="tile.filter !== null && (filter = tile.filter)"
            >
              <div
                class="flex size-11 shrink-0 items-center justify-center rounded-full"
                :class="toneClass[tile.tone]"
              >
                <UIcon
                  :name="tile.icon"
                  class="size-5"
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
                  {{ t(`compliance.tiles.${tile.key}`) }}
                </p>
              </div>
            </component>
          </div>
        </MotionReveal>

        <!-- Loading -->
        <USkeleton
          v-if="loading"
          class="h-80 w-full"
        />

        <!-- All clear -->
        <div
          v-else-if="allClear"
          class="flex flex-col items-center rounded-xl bg-default py-16 text-center ring-1 ring-default"
        >
          <div class="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <UIcon
              name="i-lucide-shield-check"
              class="size-7 text-primary"
            />
          </div>
          <p class="mt-4 text-lg font-semibold text-highlighted">
            {{ t('compliance.allClear.title') }}
          </p>
          <p class="mt-1 max-w-sm text-sm text-muted">
            {{ t('compliance.allClear.description') }}
          </p>
        </div>

        <!-- Gap list -->
        <MotionReveal
          v-else-if="report"
          :delay="0.12"
          class="flex flex-col gap-4 rounded-xl bg-default p-4 ring-1 ring-default sm:p-5"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <UFieldGroup>
              <UButton
                v-for="option in (['all', 'guardian', 'consent'] as const)"
                :key="option"
                size="sm"
                :color="filter === option ? 'primary' : 'neutral'"
                :variant="filter === option ? 'solid' : 'subtle'"
                :label="t(`compliance.filter.${option}`)"
                @click="filter = option"
              />
            </UFieldGroup>
            <UInput
              v-model="search"
              icon="i-lucide-search"
              size="sm"
              class="w-full sm:w-64"
              :placeholder="t('compliance.searchPlaceholder')"
            />
          </div>

          <p
            v-if="visibleRows.length === 0"
            class="rounded-lg bg-elevated/40 px-4 py-10 text-center text-sm text-muted"
          >
            {{ t('compliance.noMatch') }}
          </p>

          <div
            v-else
            class="overflow-x-auto"
          >
            <table class="w-full min-w-[36rem] text-sm">
              <thead>
                <tr class="border-b border-default text-left text-xs font-medium uppercase tracking-wide text-dimmed">
                  <th class="py-2 pr-4 font-medium">
                    {{ t('compliance.columns.member') }}
                  </th>
                  <th class="py-2 pr-4 font-medium">
                    {{ t('compliance.columns.gaps') }}
                  </th>
                  <th class="py-2 pl-4 text-right font-medium">
                    <span class="sr-only">{{ t('compliance.columns.action') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="row in visibleRows"
                  :key="row.memberId"
                  class="group"
                >
                  <td class="py-3 pr-4">
                    <div class="flex items-center gap-3">
                      <UAvatar
                        :src="row.user.image ?? undefined"
                        :alt="row.user.name"
                        size="sm"
                      />
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <p class="truncate font-medium text-highlighted">
                            {{ row.user.name }}
                          </p>
                          <UBadge
                            v-if="row.isMinor"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            :label="t('compliance.minor', { age: row.age })"
                          />
                        </div>
                        <p class="truncate text-xs text-muted">
                          {{ row.user.email }}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td class="py-3 pr-4">
                    <div class="flex flex-wrap gap-1.5">
                      <UBadge
                        v-if="row.missingGuardian"
                        color="error"
                        variant="subtle"
                        size="sm"
                        icon="i-lucide-user-x"
                        :label="t('compliance.gap.guardian')"
                      />
                      <UBadge
                        v-if="row.missingImageConsent"
                        color="warning"
                        variant="subtle"
                        size="sm"
                        icon="i-lucide-scan-face"
                        :label="t('compliance.gap.imageConsent')"
                      />
                    </div>
                  </td>
                  <td class="py-3 pl-4 text-right">
                    <UButton
                      :to="`/school/members/${row.memberId}`"
                      color="neutral"
                      variant="subtle"
                      size="xs"
                      trailing-icon="i-lucide-arrow-right"
                      :label="t('compliance.resolve')"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </MotionReveal>
      </div>
    </template>
  </UDashboardPanel>
</template>
