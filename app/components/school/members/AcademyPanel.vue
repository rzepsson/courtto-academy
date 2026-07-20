<script setup lang="ts">
import { DateTime } from 'luxon'
import type { MemberAcademyView } from '~/utils/academy'

// A member's Academy engagement: KPI tiles + the groups they're in + a weekday×hour
// heatmap, over a rolling window. Deliberately mirrors the court utilization panel
// — same period selector, same sequential single-hue heatmap, same legend — because
// it answers the same shape of question about a person instead of a court.
//
// A member is never both a coach and a student, so exactly one lens renders.
const props = defineProps<{ memberId: string, timezone: string }>()

const { t, locale } = useI18n()

const PERIODS = [7, 30, 90] as const
const days = ref<number>(30)

// A whole-local-day window ending today, so weekday counts in the heatmap are
// stable (matches the courts panel).
const range = computed(() => {
  const end = DateTime.now().setZone(props.timezone).plus({ days: 1 }).startOf('day')
  const start = end.minus({ days: days.value })
  return { from: start.toUTC().toISO()!, to: end.toUTC().toISO()! }
})

const { data, status } = await useLazyFetch<{ academy: MemberAcademyView }>(
  () => `/api/school/members/${props.memberId}/academy`,
  { key: 'member-detail:academy', query: computed(() => range.value) }
)

const academy = computed<MemberAcademyView | null>(() => data.value?.academy ?? null)
const loading = computed(() => status.value === 'pending')

// Which lens applies to this person. `null` = they neither teach nor train (e.g. a
// non-coaching admin) — an honest state, not an error.
const lens = computed<'teaching' | 'learning' | null>(() => {
  if (academy.value?.teaching) return 'teaching'
  if (academy.value?.learning) return 'learning'
  return null
})
const load = computed(() => academy.value?.teaching ?? academy.value?.learning ?? null)
const learning = computed(() => academy.value?.learning ?? null)
const hasActivity = computed(() => (load.value?.sessionCount ?? 0) > 0)

const weekdays = computed(() => weekdayLabels(locale.value))
const peakMinutes = computed(() => load.value?.peakBucket?.minutes ?? 0)

// Only the hours that actually contain activity — a person's day is narrower than
// a facility's operating window, so showing 00–24 would be mostly empty.
const hours = computed(() => {
  const heatmap = load.value?.heatmap
  if (!heatmap) return []
  let lo = 24
  let hi = 0
  for (let hour = 0; hour < 24; hour++) {
    let any = 0
    for (let wd = 0; wd < 7; wd++) any += heatmapCell(heatmap, wd, hour)
    if (any > 0) {
      lo = Math.min(lo, hour)
      hi = Math.max(hi, hour + 1)
    }
  }
  return lo >= hi ? [] : Array.from({ length: hi - lo }, (_, i) => lo + i)
})

const peakLabel = computed(() => {
  const peak = load.value?.peakBucket
  if (!peak) return null
  return `${weekdays.value[peak.weekday]} ${String(peak.hour).padStart(2, '0')}:00`
})

const attendanceLabel = computed(() => {
  const rate = learning.value?.attendanceRate
  return rate === null || rate === undefined ? '—' : `${Math.round(rate)}%`
})

function cellTitle(weekday: number, hour: number): string {
  const minutes = load.value ? heatmapCell(load.value.heatmap, weekday, hour) : 0
  return `${weekdays.value[weekday]} ${String(hour).padStart(2, '0')}:00 · ${formatHours(minutes)}`
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-semibold text-highlighted">
          {{ t('school.members.academy.title') }}
        </h2>
        <UFieldGroup>
          <UButton
            v-for="period in PERIODS"
            :key="period"
            size="xs"
            :color="days === period ? 'primary' : 'neutral'"
            :variant="days === period ? 'solid' : 'subtle'"
            :label="t('school.members.academy.daysShort', { n: period })"
            @click="days = period"
          />
        </UFieldGroup>
      </div>
    </template>

    <div
      v-if="loading"
      class="flex justify-center py-10"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-dimmed"
      />
    </div>

    <!-- Neither a coach nor a student: nothing to measure, and that's a fact about
         the member, not a failure — say so and point at the fix. -->
    <div
      v-else-if="lens === null"
      class="flex flex-col items-center py-10 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
        <UIcon
          name="i-lucide-graduation-cap"
          class="size-6 text-dimmed"
        />
      </div>
      <p class="mt-3 text-sm font-medium text-highlighted">
        {{ t('school.members.academy.none.title') }}
      </p>
      <p class="mt-1 max-w-sm text-sm text-muted">
        {{ t('school.members.academy.none.description') }}
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-5"
    >
      <!-- KPI tiles: the headline numbers are magnitudes, so they're tiles, not a
           chart. Attendance only exists on the learning lens. -->
      <div
        class="grid grid-cols-2 gap-3"
        :class="learning ? 'lg:grid-cols-4' : 'lg:grid-cols-3'"
      >
        <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
          <p class="text-2xl font-semibold tabular-nums text-highlighted">
            {{ load ? formatHours(load.minutes) : '—' }}
          </p>
          <p class="mt-0.5 truncate text-xs text-muted">
            {{ t(`school.members.academy.${lens}.hours`) }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
          <p class="text-2xl font-semibold tabular-nums text-highlighted">
            {{ load ? load.sessionCount : '—' }}
          </p>
          <p class="mt-0.5 truncate text-xs text-muted">
            {{ t('school.members.academy.sessions') }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
          <p class="text-2xl font-semibold tabular-nums text-highlighted">
            {{ load ? load.groups.length : '—' }}
          </p>
          <p class="mt-0.5 truncate text-xs text-muted">
            {{ t(`school.members.academy.${lens}.groups`) }}
          </p>
        </div>
        <div
          v-if="learning"
          class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default"
        >
          <p class="text-2xl font-semibold tabular-nums text-highlighted">
            {{ attendanceLabel }}
          </p>
          <p class="mt-0.5 truncate text-xs text-muted">
            {{ t('school.members.academy.learning.attendance') }}
          </p>
        </div>
      </div>

      <p
        v-if="!hasActivity"
        class="rounded-lg bg-elevated/40 px-4 py-8 text-center text-sm text-muted"
      >
        {{ t('school.members.academy.empty') }}
      </p>

      <template v-else>
        <!-- Groups: an identity list, ordered by commitment. The series colour is a
             mark beside the name — never the text colour. -->
        <div>
          <h3 class="text-xs font-medium tracking-wide text-dimmed uppercase">
            {{ t(`school.members.academy.${lens}.groupsTitle`) }}
          </h3>
          <ul class="mt-2 flex flex-col divide-y divide-default/60">
            <li
              v-for="group in load?.groups ?? []"
              :key="group.seriesId"
              class="flex items-center justify-between gap-4 py-2.5"
            >
              <div class="flex min-w-0 items-center gap-2.5">
                <span
                  class="size-2.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: group.color }"
                />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ group.title }}
                  </p>
                  <p class="truncate text-xs text-muted">
                    {{ t(`school.settings.sports.${group.sport}`) }}
                  </p>
                </div>
                <UBadge
                  v-if="group.enrollmentStatus && group.enrollmentStatus !== 'enrolled'"
                  :label="t('school.members.academy.waitlisted')"
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                />
              </div>
              <div class="shrink-0 text-right">
                <p class="text-sm font-medium tabular-nums text-highlighted">
                  {{ formatHours(group.minutes) }}
                </p>
                <p class="text-xs text-dimmed tabular-nums">
                  {{ t('school.members.academy.sessionsCount', { n: group.sessionCount }) }}
                </p>
              </div>
            </li>
          </ul>
        </div>

        <!-- Weekday × hour heatmap — sequential, single hue (CVD-safe by
             construction); identical language to the court panel. -->
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
              <!-- Cells carry a hover title; the KPI tiles + peak callout carry the
                   accessible summary (mirrors the court panel's documented stance). -->
              <div
                v-for="hour in hours"
                :key="hour"
                class="size-6 shrink-0 rounded-sm ring-1 ring-inset ring-default/60"
                :class="heatmapCellClass(load ? heatmapCell(load.heatmap, wd, hour) : 0, peakMinutes)"
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
            {{ t('school.members.academy.peak', { when: peakLabel }) }}
          </span>
          <span class="inline-flex items-center gap-1.5">
            {{ t('school.members.academy.less') }}
            <span class="size-3 rounded-sm bg-elevated ring-1 ring-inset ring-default/60" />
            <span class="size-3 rounded-sm bg-primary/30" />
            <span class="size-3 rounded-sm bg-primary/55" />
            <span class="size-3 rounded-sm bg-primary/75" />
            <span class="size-3 rounded-sm bg-primary" />
            {{ t('school.members.academy.more') }}
          </span>
        </div>
      </template>
    </div>
  </UCard>
</template>
