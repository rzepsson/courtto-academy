<script setup lang="ts">
// The org-wide governance audit feed. Keyset-paginated ("load more"): the log is
// append-only, so an OFFSET pager would skip/repeat rows as new entries land at
// the head. This is also the only surface where events about an already-removed
// member stay visible — their per-member timeline is unreachable once gone.
definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const { toastError } = useApiError()

interface AuditEntryView {
  id: string
  action: string
  actorMemberId: string | null
  targetMemberId: string | null
  data: Record<string, string | number | null> | null
  createdAt: string
}

const { data, status } = await useLazyFetch<{ entries: AuditEntryView[], nextCursor: string | null }>(
  '/api/school/audit',
  { key: 'school:audit' }
)

// The first page comes from the fetch; "load more" appends older pages onto it,
// so the rendered list is the fetched head plus everything we've pulled since.
const older = ref<AuditEntryView[]>([])
const cursor = ref<string | null>(null)
const loadingMore = ref(false)

watch(data, (value) => {
  older.value = []
  cursor.value = value?.nextCursor ?? null
}, { immediate: true })

const entries = computed(() => [...(data.value?.entries ?? []), ...older.value])
const loading = computed(() => status.value === 'pending')

async function loadMore() {
  if (!cursor.value || loadingMore.value) {
    return
  }
  loadingMore.value = true
  try {
    const page = await $fetch<{ entries: AuditEntryView[], nextCursor: string | null }>('/api/school/audit', {
      query: { cursor: cursor.value }
    })
    older.value = [...older.value, ...page.entries]
    cursor.value = page.nextCursor
  } catch (error) {
    toastError('audit.loadFailed', error)
  } finally {
    loadingMore.value = false
  }
}

function targetName(entry: AuditEntryView): string | null {
  const name = entry.data?.targetName
  return typeof name === 'string' ? name : null
}

function actorName(entry: AuditEntryView): string | null {
  const name = entry.data?.actorName
  return typeof name === 'string' ? name : null
}
</script>

<template>
  <UDashboardPanel id="school-audit">
    <template #header>
      <UDashboardNavbar :title="t('audit.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <MotionReveal>
        <UCard variant="subtle">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              {{ t('audit.title') }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{ t('audit.subtitle') }}
            </p>
          </template>

          <AppListSkeleton
            v-if="loading"
            :rows="6"
          />

          <div
            v-else-if="entries.length === 0"
            class="flex flex-col items-center py-10 text-center"
          >
            <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-history"
                class="size-6 text-dimmed"
              />
            </div>
            <p class="mt-3 text-sm font-medium text-highlighted">
              {{ t('audit.empty.title') }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-muted">
              {{ t('audit.empty.description') }}
            </p>
          </div>

          <template v-else>
            <ol class="flex flex-col gap-4">
              <li
                v-for="entry in entries"
                :key="entry.id"
                class="flex gap-3"
              >
                <div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
                  <UIcon
                    :name="auditActionIcon(entry.action)"
                    class="size-4 text-dimmed"
                  />
                </div>
                <div class="min-w-0">
                  <p class="text-sm text-highlighted">
                    <ULink
                      v-if="entry.targetMemberId && targetName(entry)"
                      :to="`/school/members/${entry.targetMemberId}`"
                      class="font-medium hover:text-primary"
                    >
                      {{ targetName(entry) }}
                    </ULink>
                    <span
                      v-else-if="targetName(entry)"
                      class="font-medium"
                    >{{ targetName(entry) }}</span>
                    <span v-if="targetName(entry)"> — </span>
                    {{ auditActionText(entry, t) }}
                  </p>
                  <p class="mt-0.5 text-xs text-dimmed">
                    <template v-if="actorName(entry)">
                      {{ t('audit.by', { actor: actorName(entry) }) }} ·
                    </template>
                    {{ formatRelativeTime(entry.createdAt, locale) }}
                  </p>
                </div>
              </li>
            </ol>

            <div
              v-if="cursor"
              class="mt-6 flex justify-center"
            >
              <UButton
                color="neutral"
                variant="subtle"
                size="sm"
                :loading="loadingMore"
                :label="t('audit.loadMore')"
                @click="loadMore"
              />
            </div>
          </template>
        </UCard>
      </MotionReveal>
    </template>
  </UDashboardPanel>
</template>
