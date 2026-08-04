<script setup lang="ts">
import type { OverviewSessionView } from '~/utils/overview'

// Today's lessons, ordered by start — the most operationally useful glance on the
// dashboard. Each row: start time, a series-colour identity dot, title + sport,
// and the court/coach it's on. The colour is a mark beside the text; the text
// itself stays in ink (per the dataviz rules).
defineProps<{
  sessions: OverviewSessionView[]
  timezone: string
  locale: string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex h-full flex-col rounded-xl bg-default p-5 ring-1 ring-default">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-calendar-clock"
          class="size-4 text-dimmed"
        />
        <h2 class="text-sm font-semibold text-highlighted">
          {{ t('overview.today.title') }}
        </h2>
      </div>
      <UButton
        to="/school/schedule"
        color="neutral"
        variant="link"
        size="xs"
        trailing-icon="i-lucide-arrow-right"
        :label="t('overview.today.viewSchedule')"
      />
    </div>

    <div
      v-if="sessions.length === 0"
      class="flex flex-1 flex-col items-center justify-center py-10 text-center"
    >
      <div class="flex size-11 items-center justify-center rounded-full bg-elevated">
        <UIcon
          name="i-lucide-coffee"
          class="size-5 text-dimmed"
        />
      </div>
      <p class="mt-3 text-sm font-medium text-highlighted">
        {{ t('overview.today.empty.title') }}
      </p>
      <p class="mt-1 max-w-xs text-sm text-muted">
        {{ t('overview.today.empty.description') }}
      </p>
    </div>

    <ol
      v-else
      class="mt-4 flex flex-col divide-y divide-default"
    >
      <li
        v-for="session in sessions"
        :key="session.id"
        class="flex items-center gap-3 py-2.5 first:pt-0"
      >
        <div class="w-24 shrink-0 text-sm font-medium tabular-nums text-highlighted">
          {{ formatTimeInZone(session.startsAt, timezone, locale) }}
          <span class="text-dimmed">–{{ formatTimeInZone(session.endsAt, timezone, locale) }}</span>
        </div>
        <span
          class="size-2.5 shrink-0 rounded-full"
          :style="{ backgroundColor: session.color }"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted">
            {{ session.title }}
          </p>
          <p class="truncate text-xs text-muted">
            {{ t(`school.settings.sports.${session.sport}`) }}
          </p>
        </div>
        <div class="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-muted sm:flex">
          <span
            v-if="session.courtName"
            class="inline-flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-land-plot"
              class="size-3.5 text-dimmed"
            />
            {{ session.courtName }}
          </span>
          <span
            v-if="session.coachName"
            class="inline-flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-user-round-check"
              class="size-3.5 text-dimmed"
            />
            {{ session.coachName }}
          </span>
        </div>
      </li>
    </ol>
  </div>
</template>
