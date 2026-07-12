<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'
import type { ScheduleSessionView } from '~/utils/schedule'

// The agenda layout: sessions grouped into ascending local days, each a scannable
// row (time · title · court · coach · status). A calm, dense alternative to the
// resource grid — the same click-to-open behaviour, no drag/create.
const props = defineProps<{
  sessions: ScheduleSessionView[]
  timezone: string
  courts?: CourtView[]
  coaches?: { id: string, name: string }[]
  loading?: boolean
}>()

const emit = defineEmits<{ select: [session: ScheduleSessionView] }>()

const { t, locale } = useI18n()

const courtNames = computed(() => new Map((props.courts ?? []).map(c => [c.id, c.name])))
const coachNames = computed(() => new Map((props.coaches ?? []).map(c => [c.id, c.name])))

const days = computed(() => groupSessionsByDay(props.sessions, props.timezone))

const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const todayKey = computed(() => DateTime.now().setZone(props.timezone).toFormat('yyyy-MM-dd'))

function dayLabel(key: string): string {
  return DateTime.fromISO(key, { zone: props.timezone }).setLocale(locale.value).toFormat('cccc, d LLLL')
}
function timeLabel(session: ScheduleSessionView): string {
  const start = DateTime.fromISO(session.startsAt, { zone: props.timezone })
  const end = DateTime.fromISO(session.endsAt, { zone: props.timezone })
  return `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`
}
function courtName(session: ScheduleSessionView): string | null {
  return session.courtId ? courtNames.value.get(session.courtId) ?? null : null
}
function coachName(session: ScheduleSessionView): string | null {
  return session.coachMemberId ? coachNames.value.get(session.coachMemberId) ?? null : null
}
function isCancelled(session: ScheduleSessionView): boolean {
  return session.status === 'cancelled' || session.reservationStatus === 'cancelled'
}
</script>

<template>
  <div class="rounded-xl border border-default bg-default">
    <div
      v-if="loading"
      class="p-4"
    >
      <AppListSkeleton :rows="4" />
    </div>

    <p
      v-else-if="days.length === 0"
      class="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-calendar-days"
        class="size-6 text-dimmed"
      />
      {{ t('schedule.agenda.empty') }}
    </p>

    <div
      v-for="day in days"
      v-else
      :key="day.key"
      class="border-b border-default last:border-b-0"
    >
      <div class="sticky top-0 z-10 flex items-center justify-between gap-3 bg-elevated/60 px-4 py-2 backdrop-blur">
        <div class="flex items-center gap-2">
          <span
            class="text-sm font-semibold capitalize"
            :class="mounted && day.key === todayKey ? 'text-primary' : 'text-highlighted'"
          >
            {{ dayLabel(day.key) }}
          </span>
          <UBadge
            v-if="mounted && day.key === todayKey"
            :label="t('schedule.calendar.today')"
            color="primary"
            variant="subtle"
            size="sm"
          />
        </div>
        <span class="text-xs tabular-nums text-muted">
          {{ t('schedule.agenda.count', { n: day.sessions.length }) }}
        </span>
      </div>

      <ul class="divide-y divide-default">
        <li
          v-for="session in day.sessions"
          :key="session.id"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/50 focus:outline-none focus-visible:bg-elevated/50"
            :class="isCancelled(session) && 'opacity-50'"
            @click="emit('select', session)"
          >
            <span
              class="h-9 w-1 shrink-0 rounded-full"
              :style="{ backgroundColor: session.color }"
            />
            <span class="w-24 shrink-0 text-sm font-medium tabular-nums text-highlighted">
              {{ timeLabel(session) }}
            </span>
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium text-highlighted"
                :class="isCancelled(session) && 'line-through'"
              >
                {{ session.seriesTitle }}
              </p>
              <p class="mt-0.5 flex items-center gap-2 truncate text-xs text-muted">
                <span>{{ t(`schedule.types.${session.type}`) }}</span>
                <template v-if="courtName(session)">
                  <span class="text-dimmed">·</span>
                  <span class="inline-flex items-center gap-1">
                    <UIcon
                      name="i-lucide-land-plot"
                      class="size-3"
                    />
                    {{ courtName(session) }}
                  </span>
                </template>
                <template v-if="coachName(session)">
                  <span class="text-dimmed">·</span>
                  <span class="inline-flex items-center gap-1">
                    <UIcon
                      name="i-lucide-user-round"
                      class="size-3"
                    />
                    {{ coachName(session) }}
                  </span>
                </template>
              </p>
            </div>
            <ScheduleSessionBadge
              v-if="session.status !== 'scheduled'"
              :status="session.status"
              size="sm"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-dimmed"
            />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
