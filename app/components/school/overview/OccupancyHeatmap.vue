<script setup lang="ts">
import type { SchoolOverviewView } from '~/utils/overview'

// Facility-wide occupancy over the rolling last 7 days: a KPI line + a weekday×hour
// demand heatmap. Same engine + single-hue sequential ramp as the per-court panel
// (CVD-safe by construction), so the two read identically. Magnitude is a grid of
// tiles, never a chart — per the dataviz skill.
const props = defineProps<{ week: SchoolOverviewView['week'], locale: string }>()

const { t } = useI18n()

const weekdays = computed(() => weekdayLabels(props.locale))
const peakMinutes = computed(() => props.week.peakBucket?.minutes ?? 0)
const hasActivity = computed(() => props.week.lessonCount > 0)

// The operating window, widened to include any off-hours activity so nothing hides.
const hours = computed(() => {
  const w = props.week
  let lo = w.operating.open
  let hi = w.operating.close
  for (let h = 0; h < 24; h++) {
    let any = 0
    for (let wd = 0; wd < 7; wd++) any += heatmapCell(w.heatmap, wd, h)
    if (any > 0) {
      lo = Math.min(lo, h)
      hi = Math.max(hi, h + 1)
    }
  }
  return Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i)
})

const peakLabel = computed(() => {
  const peak = props.week.peakBucket
  if (!peak) return null
  return `${weekdays.value[peak.weekday]} ${String(peak.hour).padStart(2, '0')}:00`
})

function cellTitle(weekday: number, hour: number): string {
  const minutes = heatmapCell(props.week.heatmap, weekday, hour)
  return `${weekdays.value[weekday]} ${String(hour).padStart(2, '0')}:00 · ${formatHours(minutes)}`
}
</script>

<template>
  <div class="flex flex-col gap-4 rounded-xl bg-default p-5 ring-1 ring-default">
    <div class="flex items-center gap-2">
      <UIcon
        name="i-lucide-activity"
        class="size-4 text-dimmed"
      />
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('overview.occupancy.title') }}
      </h2>
      <UBadge
        :label="t('overview.occupancy.window')"
        color="neutral"
        variant="subtle"
        size="sm"
      />
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ Math.round(week.occupancyPct) }}%
        </p>
        <p class="mt-0.5 text-xs text-muted">
          {{ t('overview.occupancy.rate') }}
        </p>
      </div>
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ formatHours(week.lessonHours * 60) }}
        </p>
        <p class="mt-0.5 text-xs text-muted">
          {{ t('overview.occupancy.lessonHours') }}
        </p>
      </div>
      <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
        <p class="text-2xl font-semibold tabular-nums text-highlighted">
          {{ week.lessonCount }}
        </p>
        <p class="mt-0.5 text-xs text-muted">
          {{ t('overview.occupancy.lessons') }}
        </p>
      </div>
    </div>

    <p
      v-if="!hasActivity"
      class="rounded-lg bg-elevated/40 px-4 py-8 text-center text-sm text-muted"
    >
      {{ t('overview.occupancy.empty') }}
    </p>
    <template v-else>
      <div class="overflow-x-auto">
        <div class="min-w-fit">
          <div class="flex items-center gap-1 pl-9">
            <div
              v-for="hour in hours"
              :key="hour"
              class="w-6 shrink-0 text-center text-[10px] tabular-nums text-dimmed"
            >
              {{ hour }}
            </div>
          </div>
          <div
            v-for="(label, wd) in weekdays"
            :key="wd"
            class="mt-1 flex items-center gap-1"
          >
            <div class="w-8 shrink-0 text-right text-[11px] font-medium text-muted">
              {{ label }}
            </div>
            <div
              v-for="hour in hours"
              :key="hour"
              class="size-6 shrink-0 rounded-sm ring-1 ring-inset ring-default/60"
              :class="heatmapCellClass(heatmapCell(week.heatmap, wd, hour), peakMinutes)"
              :title="cellTitle(wd, hour)"
            />
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span
          v-if="peakLabel"
          class="inline-flex items-center gap-1.5"
        >
          <UIcon
            name="i-lucide-flame"
            class="size-3.5 text-dimmed"
          />
          {{ t('overview.occupancy.peak', { when: peakLabel }) }}
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
