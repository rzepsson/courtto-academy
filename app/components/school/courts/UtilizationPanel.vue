<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtUtilizationView } from '~/utils/utilization'

// Court utilization: KPI tiles + a weekday×hour demand heatmap over a rolling
// window. Reads the CORE reservation-derived utilization endpoint, so it's
// product-neutral — a future Courtto `booking` counts as usage automatically.
const props = defineProps<{ courtId: string, timezone: string }>()

const { t, locale } = useI18n()

const PERIODS = [7, 30, 90] as const
const days = ref<number>(30)

// A whole-local-day window ending today (stable weekday counts for the heatmap).
const range = computed(() => {
  const end = DateTime.now().setZone(props.timezone).plus({ days: 1 }).startOf('day')
  const start = end.minus({ days: days.value })
  return { from: start.toUTC().toISO()!, to: end.toUTC().toISO()! }
})

const { data, status } = await useLazyFetch<{ utilization: CourtUtilizationView }>(
  () => `/api/school/courts/${props.courtId}/utilization`,
  { key: 'court-detail:utilization', query: computed(() => range.value) }
)
const util = computed<CourtUtilizationView | null>(() => data.value?.utilization ?? null)
const loading = computed(() => status.value === 'pending')
const hasActivity = computed(() => !!util.value && (util.value.usageCount > 0 || util.value.downtimeMinutes > 0))

const weekdays = computed(() => weekdayLabels(locale.value))
const peakMinutes = computed(() => util.value?.peakBucket?.minutes ?? 0)

// Show the operating window, widened to include any off-hours activity so nothing
// is hidden (mirrors the calendar band).
const hours = computed(() => {
  const u = util.value
  let lo = u ? u.operating.open : 7
  let hi = u ? u.operating.close : 23
  if (u) {
    for (let h = 0; h < 24; h++) {
      let any = 0
      for (let wd = 0; wd < 7; wd++) any += heatmapCell(u.heatmap, wd, h)
      if (any > 0) {
        lo = Math.min(lo, h)
        hi = Math.max(hi, h + 1)
      }
    }
  }
  return Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i)
})

const utilizationLabel = computed(() => (util.value ? `${Math.round(util.value.utilizationPct)}%` : '—'))
const windowLabel = computed(() =>
  util.value ? `${String(util.value.operating.open).padStart(2, '0')}:00–${String(util.value.operating.close).padStart(2, '0')}:00` : ''
)
const peakLabel = computed(() => {
  const peak = util.value?.peakBucket
  if (!peak) return null
  return `${weekdays.value[peak.weekday]} ${String(peak.hour).padStart(2, '0')}:00`
})

function cellTitle(weekday: number, hour: number): string {
  const minutes = util.value ? heatmapCell(util.value.heatmap, weekday, hour) : 0
  return `${weekdays.value[weekday]} ${String(hour).padStart(2, '0')}:00 · ${formatHours(minutes)}`
}
</script>

<template>
  <div class="flex flex-col gap-4 rounded-xl bg-default p-4 ring-1 ring-default">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-bar-chart-3"
          class="size-4 text-dimmed"
        />
        <h2 class="text-sm font-semibold text-highlighted">
          {{ t('courts.utilization.title') }}
        </h2>
      </div>
      <UFieldGroup>
        <UButton
          v-for="period in PERIODS"
          :key="period"
          size="xs"
          :color="days === period ? 'primary' : 'neutral'"
          :variant="days === period ? 'solid' : 'subtle'"
          :label="t('courts.utilization.daysShort', { n: period })"
          @click="days = period"
        />
      </UFieldGroup>
    </div>

    <!-- KPI tiles — Academy terms (lessons); the neutral core also counts a future
         Courtto `booking`, but that's not surfaced until the product exists. -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ utilizationLabel }}
        </p>
        <p class="mt-0.5 truncate text-xs text-muted">
          {{ t('courts.utilization.occupancy', { window: windowLabel }) }}
        </p>
      </div>
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ util ? formatHours(util.usageMinutes) : '—' }}
        </p>
        <p class="mt-0.5 text-xs text-muted">
          {{ t('courts.utilization.lessonHours') }}
        </p>
      </div>
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ util ? util.usageCount : '—' }}
        </p>
        <p class="mt-0.5 text-xs text-muted">
          {{ t('courts.utilization.sessions') }}
        </p>
      </div>
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ util ? formatHours(util.downtimeMinutes) : '—' }}
        </p>
        <p class="mt-0.5 text-xs text-muted">
          {{ t('courts.utilization.downtime') }}
        </p>
      </div>
    </div>

    <!-- Heatmap -->
    <div
      v-if="loading"
      class="flex justify-center py-8"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-dimmed"
      />
    </div>
    <p
      v-else-if="!hasActivity"
      class="rounded-lg bg-elevated/40 px-4 py-8 text-center text-sm text-muted"
    >
      {{ t('courts.utilization.empty') }}
    </p>
    <template v-else>
      <div class="overflow-x-auto">
        <div class="min-w-fit">
          <!-- Hour header -->
          <div class="flex items-center gap-1 pl-9">
            <div
              v-for="hour in hours"
              :key="hour"
              class="w-6 shrink-0 text-center text-[10px] tabular-nums text-dimmed"
            >
              {{ hour }}
            </div>
          </div>
          <!-- Rows -->
          <div
            v-for="(label, wd) in weekdays"
            :key="wd"
            class="mt-1 flex items-center gap-1"
          >
            <div class="w-8 shrink-0 text-right text-[11px] font-medium text-muted">
              {{ label }}
            </div>
            <!-- Data cells: non-interactive (a mouse-hover title, no keyboard
                 tab-stop per cell); the KPI tiles + peak callout carry the
                 accessible summary. A full table view is the documented a11y next step. -->
            <div
              v-for="hour in hours"
              :key="hour"
              class="size-6 shrink-0 rounded-sm ring-1 ring-inset ring-default/60"
              :class="heatmapCellClass(util ? heatmapCell(util.heatmap, wd, hour) : 0, peakMinutes)"
              :title="cellTitle(wd, hour)"
            />
          </div>
        </div>
      </div>

      <!-- Legend + peak -->
      <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span
          v-if="peakLabel"
          class="inline-flex items-center gap-1.5"
        >
          <UIcon
            name="i-lucide-flame"
            class="size-3.5 text-dimmed"
          />
          {{ t('courts.utilization.peak', { when: peakLabel }) }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          {{ t('courts.utilization.less') }}
          <span class="size-3 rounded-sm bg-elevated ring-1 ring-inset ring-default/60" />
          <span class="size-3 rounded-sm bg-primary/30" />
          <span class="size-3 rounded-sm bg-primary/55" />
          <span class="size-3 rounded-sm bg-primary/75" />
          <span class="size-3 rounded-sm bg-primary" />
          {{ t('courts.utilization.more') }}
        </span>
      </div>
    </template>
  </div>
</template>
