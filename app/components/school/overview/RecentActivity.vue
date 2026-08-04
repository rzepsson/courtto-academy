<script setup lang="ts">
import type { OverviewActivityView } from '~/utils/overview'

// A compact tail of the org-wide audit feed — the same line rendering as the full
// Activity log (shared auditActionText/auditActionIcon), capped, with a link to
// the full page. Read-only glance; the full page owns pagination.
defineProps<{ entries: OverviewActivityView[], locale: string }>()

const { t } = useI18n()

function targetName(entry: OverviewActivityView): string | null {
  const name = entry.data?.targetName
  return typeof name === 'string' ? name : null
}
</script>

<template>
  <div class="flex h-full flex-col rounded-xl bg-default p-5 ring-1 ring-default">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-history"
          class="size-4 text-dimmed"
        />
        <h2 class="text-sm font-semibold text-highlighted">
          {{ t('overview.activity.title') }}
        </h2>
      </div>
      <UButton
        v-if="entries.length"
        to="/school/audit"
        color="neutral"
        variant="link"
        size="xs"
        trailing-icon="i-lucide-arrow-right"
        :label="t('common.viewAll')"
      />
    </div>

    <div
      v-if="entries.length === 0"
      class="flex flex-1 flex-col items-center justify-center py-8 text-center"
    >
      <p class="text-sm text-muted">
        {{ t('overview.activity.empty') }}
      </p>
    </div>

    <ol
      v-else
      class="mt-4 flex flex-col gap-3.5"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="flex gap-3"
      >
        <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
          <UIcon
            :name="auditActionIcon(entry.action)"
            class="size-3.5 text-dimmed"
          />
        </div>
        <div class="min-w-0">
          <p class="text-sm text-default">
            <span
              v-if="targetName(entry)"
              class="font-medium text-highlighted"
            >{{ targetName(entry) }}</span>
            <span v-if="targetName(entry)"> — </span>
            {{ auditActionText(entry, t) }}
          </p>
          <p class="mt-0.5 text-xs text-dimmed">
            {{ formatRelativeTime(entry.createdAt, locale) }}
          </p>
        </div>
      </li>
    </ol>
  </div>
</template>
