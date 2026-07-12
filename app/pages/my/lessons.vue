<script setup lang="ts">
import { DateTime } from 'luxon'
import type { ScheduleSessionView } from '~/utils/schedule'

definePageMeta({ middleware: ['auth', 'my-area'], layout: 'dashboard' })

const { t } = useI18n()

const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)
const view = ref<'day' | 'week'>('week')
const anchorISO = ref(new Date().toISOString())

const range = computed(() => {
  const anchor = DateTime.fromISO(anchorISO.value, { zone: timezone.value })
  return view.value === 'day' ? dayRange(anchor) : weekRange(anchor)
})

const { data, status } = await useLazyFetch('/api/my/schedule', {
  key: 'my:schedule',
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
  <UDashboardPanel id="my-lessons">
    <template #header>
      <UDashboardNavbar :title="t('nav.lessons')">
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
            {{ t('schedule.myTagline') }}
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
          <ScheduleCalendar
            :sessions="sessions"
            :timezone="timezone"
            :view="view"
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
        area="my"
      />
    </template>
  </UDashboardPanel>
</template>
