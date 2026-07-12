<script setup lang="ts">
import { DateTime } from 'luxon'
import type { ScheduleSessionView } from '~/utils/schedule'

// The resource calendar. Day view = courts as columns (the hero "resource" view);
// week view = days as columns. Blocks are positioned by their local start time
// and laid out side-by-side when they overlap. Editable mode adds native
// drag-to-move (a block onto another column/time) and click-empty-to-create.
const props = defineProps<{
  sessions: ScheduleSessionView[]
  timezone: string
  view: 'day' | 'week'
  anchorAt: string
  courts?: { id: string, name: string }[] // day view columns
  editable?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [session: ScheduleSessionView]
  move: [payload: { session: ScheduleSessionView, startLocal: string, courtId: string | null }]
  create: [payload: { startLocal: string, courtId: string | null }]
}>()

const { t, locale } = useI18n()

const anchor = computed(() => DateTime.fromISO(props.anchorAt, { zone: props.timezone }))

interface Column { id: string, label: string, sublabel?: string, dt: DateTime, courtId: string | null, isToday: boolean }

// A reactive clock so the now-line and "today" highlight advance while the
// calendar stays open. Client-only (hidden until mounted) to avoid an SSR↔client
// time mismatch.
const now = ref(DateTime.now())
const mounted = ref(false)
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  mounted.value = true
  clock = setInterval(() => {
    now.value = DateTime.now()
  }, 60_000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})
const nowZoned = computed(() => now.value.setZone(props.timezone))

const columns = computed<Column[]>(() => {
  const todayKey = nowZoned.value.toFormat('yyyy-MM-dd')
  if (props.view === 'week') {
    return weekDays(anchor.value).map((d) => {
      const dl = d.setLocale(locale.value)
      const key = d.toFormat('yyyy-MM-dd')
      return { id: key, label: dl.toFormat('ccc'), sublabel: dl.toFormat('d LLL'), dt: d, courtId: null, isToday: key === todayKey }
    })
  }
  const isToday = anchor.value.toFormat('yyyy-MM-dd') === todayKey
  const day = anchor.value.startOf('day')
  if (props.courts && props.courts.length) {
    const cols: Column[] = props.courts.map(c => ({ id: c.id, label: c.name, dt: day, courtId: c.id, isToday }))
    // Sessions on a court that's no longer an active column (e.g. archived) still
    // need to be visible/clickable — collect them under an "Other" column.
    const known = new Set(props.courts.map(c => c.id))
    if (props.sessions.some(s => !s.courtId || !known.has(s.courtId))) {
      cols.push({ id: '__other__', label: t('schedule.calendar.otherCourt'), dt: day, courtId: null, isToday })
    }
    return cols
  }
  return [{ id: '__all__', label: t('schedule.calendar.allCourts'), dt: day, courtId: null, isToday }]
})

function columnIdOf(session: ScheduleSessionView): string {
  if (props.view === 'week') return localDayKey(session.startsAt, props.timezone)
  if (props.courts && props.courts.length) {
    return props.courts.some(c => c.id === session.courtId) ? session.courtId! : '__other__'
  }
  return '__all__'
}

function blockLabel(session: ScheduleSessionView): string {
  const start = DateTime.fromISO(session.startsAt, { zone: props.timezone }).toFormat('HH:mm')
  return `${session.seriesTitle}, ${start}, ${t(`schedule.sessionStatus.${session.status}`)}`
}

// Per-column overlap layout.
const layout = computed(() => {
  const byColumn = new Map<string, ScheduleSessionView[]>()
  for (const s of props.sessions) {
    const key = columnIdOf(s)
    ;(byColumn.get(key) ?? byColumn.set(key, []).get(key)!).push(s)
  }
  const out = new Map<string, { session: ScheduleSessionView, top: number, height: number, leftPct: number, widthPct: number }[]>()
  for (const [key, list] of byColumn) {
    const lanes = computeLanes(
      list,
      s => localMinutes(s.startsAt, props.timezone),
      s => localMinutes(s.startsAt, props.timezone) + durationMinutes(s.startsAt, s.endsAt)
    )
    out.set(key, lanes.map(({ item, lane, laneCount }) => {
      const startMin = localMinutes(item.startsAt, props.timezone)
      const geom = blockGeometry(startMin, startMin + durationMinutes(item.startsAt, item.endsAt))
      const widthPct = 100 / laneCount
      return { session: item, top: geom.top, height: geom.height, leftPct: lane * widthPct, widthPct }
    }))
  }
  return out
})

const hours = computed(() =>
  Array.from({ length: CALENDAR.dayEndHour - CALENDAR.dayStartHour + 1 }, (_, i) => CALENDAR.dayStartHour + i)
)
const bodyHeight = computed(() => gridHeightPx())

const nowTop = computed(() => {
  const minutes = nowZoned.value.hour * 60 + nowZoned.value.minute
  const bandStart = CALENDAR.dayStartHour * 60
  const bandEnd = CALENDAR.dayEndHour * 60
  if (minutes < bandStart || minutes > bandEnd) return null
  return (minutes - bandStart) / 60 * CALENDAR.pxPerHour
})

// --- Interaction ---
const dragging = ref<ScheduleSessionView | null>(null)
const dragGrabOffset = ref(0) // where inside the block the drag started (px)

function localFromOffset(column: Column, offsetY: number): string {
  const minutes = offsetToMinutes(offsetY)
  return localDateTimeStamp(column.dt.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 }))
}

function onBlockDragStart(session: ScheduleSessionView, event: DragEvent) {
  if (!props.editable) return
  dragging.value = session
  dragGrabOffset.value = event.offsetY
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onColumnDragOver(event: DragEvent) {
  if (props.editable && dragging.value) event.preventDefault()
}

function onColumnDrop(event: DragEvent, column: Column) {
  const session = dragging.value
  dragging.value = null
  if (!props.editable || !session) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // Subtract the grab offset so the block's TOP lands where the user aimed, not
  // the cursor row.
  const startLocal = localFromOffset(column, event.clientY - rect.top - dragGrabOffset.value)
  const currentLocal = localDateTimeStamp(DateTime.fromISO(session.startsAt, { zone: props.timezone }))
  const targetCourt = props.view === 'week' ? null : column.courtId
  // A drop that changes nothing must not create a needless single-occurrence override.
  if (startLocal === currentLocal && (targetCourt === null || targetCourt === session.courtId)) return
  emit('move', { session, startLocal, courtId: targetCourt })
}

function onColumnClick(event: MouseEvent, column: Column) {
  if (!props.editable) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit('create', { startLocal: localFromOffset(column, event.clientY - rect.top), courtId: column.courtId })
}
</script>

<template>
  <div class="overflow-x-auto rounded-xl border border-default bg-default">
    <div class="min-w-fit">
      <!-- Column headers -->
      <div class="sticky top-0 z-20 flex border-b border-default bg-default/95 backdrop-blur">
        <div class="w-14 shrink-0" />
        <div
          v-for="col in columns"
          :key="col.id"
          class="flex-1 border-l border-default px-2 py-2 text-center"
          :style="{ minWidth: view === 'week' ? '7rem' : '9rem' }"
        >
          <p
            class="truncate text-xs font-medium"
            :class="col.isToday ? 'text-primary' : 'text-highlighted'"
          >
            {{ col.label }}
          </p>
          <p
            v-if="col.sublabel"
            class="truncate text-[11px]"
            :class="col.isToday ? 'text-primary' : 'text-muted'"
          >
            {{ col.sublabel }}
          </p>
        </div>
      </div>

      <!-- Time grid -->
      <div class="flex">
        <!-- Hour gutter -->
        <div
          class="w-14 shrink-0"
          :style="{ height: `${bodyHeight}px` }"
        >
          <div
            v-for="h in hours"
            :key="h"
            class="relative"
            :style="{ height: `${CALENDAR.pxPerHour}px` }"
          >
            <span class="absolute -top-2 right-1.5 text-[11px] tabular-nums text-dimmed">
              {{ String(h).padStart(2, '0') }}:00
            </span>
          </div>
        </div>

        <!-- Columns -->
        <div
          v-for="col in columns"
          :key="col.id"
          class="relative flex-1 border-l border-default"
          :class="editable && 'cursor-copy'"
          :style="{ height: `${bodyHeight}px`, minWidth: view === 'week' ? '7rem' : '9rem' }"
          @dragover="onColumnDragOver"
          @drop="onColumnDrop($event, col)"
          @click="onColumnClick($event, col)"
        >
          <!-- Hour gridlines -->
          <div
            v-for="h in hours"
            :key="h"
            class="absolute inset-x-0 border-t border-default/60"
            :style="{ top: `${(h - CALENDAR.dayStartHour) * CALENDAR.pxPerHour}px` }"
          />

          <!-- Current-time indicator -->
          <div
            v-if="mounted && col.isToday && nowTop !== null"
            class="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-primary"
            :style="{ top: `${nowTop}px` }"
          >
            <span class="absolute -top-1 -left-1 size-2 rounded-full bg-primary" />
          </div>

          <!-- Blocks -->
          <button
            v-for="entry in (layout.get(col.id) ?? [])"
            :key="entry.session.id"
            type="button"
            :draggable="editable"
            :aria-label="blockLabel(entry.session)"
            class="absolute overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="editable && 'cursor-grab active:cursor-grabbing'"
            :style="{
              top: `${entry.top}px`,
              height: `${entry.height}px`,
              left: `calc(${entry.leftPct}% + 2px)`,
              width: `calc(${entry.widthPct}% - 4px)`
            }"
            @click.stop="emit('select', entry.session)"
            @dragstart="onBlockDragStart(entry.session, $event)"
            @dragend="dragging = null"
          >
            <ScheduleBlock
              :session="entry.session"
              :timezone="timezone"
              :dense="entry.height < 34"
            />
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="loading"
      class="flex items-center justify-center gap-2 border-t border-default py-3 text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin"
      />
      {{ t('common.loading') }}
    </div>
  </div>
</template>
