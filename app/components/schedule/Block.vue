<script setup lang="ts">
import { DateTime } from 'luxon'
import type { ScheduleSessionView } from '~/utils/schedule'

// A single lesson block on the calendar grid. Tinted by the series colour (a low
// alpha fill + a solid left accent — readable in light and dark), dimmed when
// cancelled. Purely presentational; the calendar owns positioning + interaction.
const props = defineProps<{
  session: ScheduleSessionView
  timezone: string
  dense?: boolean
  coachName?: string | null
}>()

const cancelled = computed(() =>
  props.session.status === 'cancelled' || props.session.reservationStatus === 'cancelled'
)

const timeLabel = computed(() => {
  const start = DateTime.fromISO(props.session.startsAt, { zone: props.timezone })
  const end = DateTime.fromISO(props.session.endsAt, { zone: props.timezone })
  return `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`
})

// The muted sub-line: time, plus the coach when one is resolved.
const metaLabel = computed(() => props.coachName ? `${timeLabel.value} · ${props.coachName}` : timeLabel.value)

// 6-digit hex + '22' alpha → a subtle fill; the full colour is the left accent.
const style = computed(() => ({
  backgroundColor: `${props.session.color}26`,
  borderColor: props.session.color
}))
</script>

<template>
  <div
    class="flex size-full flex-col overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left ring-1 ring-default/70 transition-shadow hover:z-10 hover:shadow-md"
    :class="cancelled && 'opacity-45 grayscale'"
    :style="style"
  >
    <p
      class="truncate font-semibold leading-tight text-highlighted"
      :class="dense ? 'text-[11px]' : 'text-xs'"
    >
      <span
        v-if="session.status === 'rescheduled'"
        class="text-warning"
      >● </span>{{ session.seriesTitle }}
    </p>
    <p
      v-if="!dense"
      class="truncate text-[11px] leading-tight text-muted"
    >
      {{ metaLabel }}
    </p>
  </div>
</template>
