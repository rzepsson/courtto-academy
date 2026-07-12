<script setup lang="ts">
import { DateTime } from 'luxon'
import type { ScheduleSessionView } from '~/utils/schedule'

definePageMeta({ middleware: ['auth', 'coach'], layout: 'dashboard' })

const { t } = useI18n()

// The school timezone arrives with the sessions; start from the viewer's zone so
// the first window is sensible, then adopt the school's.
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)
const view = ref<ScheduleView>('week')
const anchorISO = ref(new Date().toISOString())

const range = computed(() => {
  const anchor = DateTime.fromISO(anchorISO.value, { zone: timezone.value })
  return view.value === 'day' ? dayRange(anchor) : weekRange(anchor)
})

const { data, status, refresh } = await useLazyFetch('/api/coach/schedule', {
  key: 'coach:schedule',
  query: computed(() => ({ from: range.value.from, to: range.value.to }))
})
// Adopt the school zone only when it differs — assigning the same value would
// recompute the range and trigger a needless second fetch.
watch(() => data.value?.timezone, (tz) => {
  if (tz && tz !== timezone.value) {
    timezone.value = tz
  }
})

const sessions = computed<ScheduleSessionView[]>(() => data.value?.sessions ?? [])
const loading = computed(() => status.value === 'pending')

const detailOpen = ref(false)
const selected = ref<ScheduleSessionView | null>(null)
function onSelect(session: ScheduleSessionView) {
  selected.value = session
  detailOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="coach-schedule">
    <template #header>
      <UDashboardNavbar :title="t('nav.schedule')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-5">
        <MotionReveal>
          <p class="max-w-2xl text-sm text-muted">
            {{ t('schedule.coachTagline') }}
          </p>
        </MotionReveal>

        <MotionReveal :delay="0.05">
          <ScheduleToolbar
            v-model:view="view"
            v-model:anchor-at="anchorISO"
            :timezone="timezone"
          />
        </MotionReveal>

        <MotionReveal :delay="0.1">
          <ScheduleAgenda
            v-if="view === 'agenda'"
            :sessions="sessions"
            :timezone="timezone"
            :loading="loading"
            @select="onSelect"
          />
          <ScheduleCalendar
            v-else
            :sessions="sessions"
            :timezone="timezone"
            :view="view === 'week' ? 'week' : 'day'"
            :anchor-at="anchorISO"
            :loading="loading"
            @select="onSelect"
          />
        </MotionReveal>
      </div>

      <ScheduleSessionSlideover
        v-model:open="detailOpen"
        :session="selected"
        :timezone="timezone"
        area="coach"
        @changed="refresh()"
      />
    </template>
  </UDashboardPanel>
</template>
