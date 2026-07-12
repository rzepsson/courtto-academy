<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'
import type { ScheduleSessionView } from '~/utils/schedule'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t } = useI18n()
const { toastError } = useApiError()

const { data: profileData } = await useFetch('/api/school/profile', { key: 'school-profile' })
const { data: courtsData } = await useLazyFetch('/api/school/courts', { key: 'school:courts' })
const { data: membersData } = await useLazyFetch('/api/school/members', { key: 'school:members' })

const timezone = computed(() => profileData.value?.profile.timezone ?? 'Europe/Warsaw')
const allowedSports = computed(() => profileData.value?.profile.sports ?? [])
const courts = computed<CourtView[]>(() => courtsData.value?.courts ?? [])
const activeCourts = computed(() => courts.value.filter(c => c.archivedAt === null))
const coaches = computed(() =>
  (membersData.value ?? []).filter(m => m.role !== 'student').map(m => ({ id: m.id, name: m.user.name }))
)
const students = computed(() =>
  (membersData.value ?? []).filter(m => m.role === 'student').map(m => ({ id: m.id, name: m.user.name, email: m.user.email }))
)
const hasCourts = computed(() => activeCourts.value.length > 0)

const view = ref<ScheduleView>('day')
const anchorISO = ref(new Date().toISOString())
const range = computed(() => {
  const anchor = DateTime.fromISO(anchorISO.value, { zone: timezone.value })
  return view.value === 'day' ? dayRange(anchor) : weekRange(anchor)
})

const { data: sessionsData, status, refresh } = await useLazyFetch('/api/school/schedule', {
  key: 'school:schedule',
  query: computed(() => ({ from: range.value.from, to: range.value.to }))
})
const sessions = computed<ScheduleSessionView[]>(() => sessionsData.value?.sessions ?? [])
const loading = computed(() => status.value === 'pending')

// Client-side filters over the already-fetched window — instant, no refetch.
const filters = reactive<ScheduleFilterState>({ coachMemberIds: [], courtIds: [], sports: [], types: [], status: 'all' })
const filteredSessions = computed(() => sessions.value.filter(s => sessionMatchesFilters(s, filters)))
// A court filter also narrows the day-view columns, not just the blocks.
const visibleCourts = computed(() =>
  filters.courtIds.length ? activeCourts.value.filter(c => filters.courtIds.includes(c.id)) : activeCourts.value
)
const noMatches = computed(() => !loading.value && sessions.value.length > 0 && filteredSessions.value.length === 0)

// --- Slideovers ---
const formOpen = ref(false)
const formPrefill = ref<{ startLocal: string, courtId: string | null } | null>(null)
const detailOpen = ref(false)
const selected = ref<ScheduleSessionView | null>(null)

function openCreate() {
  formPrefill.value = null
  formOpen.value = true
}
function onCreate(payload: { startLocal: string, courtId: string | null }) {
  formPrefill.value = payload
  formOpen.value = true
}
function onSelect(session: ScheduleSessionView) {
  selected.value = session
  detailOpen.value = true
}

// Edit the whole series: swap the detail panel for the edit slideover.
const editOpen = ref(false)
const editSeriesId = ref<string | null>(null)
function onEdit(session: ScheduleSessionView) {
  editSeriesId.value = session.seriesId
  detailOpen.value = false
  editOpen.value = true
}

// Drag-to-move a single occurrence: optimistic refresh, roll back on error.
async function onMove({ session, startLocal, courtId }: { session: ScheduleSessionView, startLocal: string, courtId: string | null }) {
  const endpoint: string = `/api/school/schedule/sessions/${session.id}`
  try {
    await $fetch(endpoint, { method: 'PATCH', body: { startsAt: startLocal, courtId: courtId || undefined } })
    await refresh()
  } catch (error) {
    toastError('schedule.errors.moveFailed', error)
    await refresh()
  }
}
</script>

<template>
  <UDashboardPanel id="school-schedule">
    <template #header>
      <UDashboardNavbar :title="t('nav.schedule')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
          <PressButton
            v-if="hasCourts"
            :block="false"
            size="md"
            icon="i-lucide-plus"
            :label="t('schedule.add')"
            @click="openCreate"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-5">
        <MotionReveal>
          <p class="max-w-2xl text-sm text-muted">
            {{ t('schedule.tagline') }}
          </p>
        </MotionReveal>

        <MotionReveal
          v-if="!hasCourts"
          :delay="0.05"
        >
          <div class="flex flex-col items-center rounded-xl border border-dashed border-default py-16 text-center">
            <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-land-plot"
                class="size-6 text-dimmed"
              />
            </div>
            <p class="mt-4 text-sm font-medium text-highlighted">
              {{ t('schedule.noCourts.title') }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-muted">
              {{ t('schedule.noCourts.description') }}
            </p>
            <UButton
              class="mt-5"
              color="neutral"
              variant="subtle"
              icon="i-lucide-land-plot"
              :label="t('schedule.noCourts.action')"
              to="/school/courts"
            />
          </div>
        </MotionReveal>

        <template v-else>
          <MotionReveal :delay="0.05">
            <div class="flex flex-col gap-3">
              <ScheduleToolbar
                v-model:view="view"
                v-model:anchor-at="anchorISO"
                :timezone="timezone"
              />
              <ScheduleFilters
                v-model:coach-member-ids="filters.coachMemberIds"
                v-model:court-ids="filters.courtIds"
                v-model:selected-sports="filters.sports"
                v-model:types="filters.types"
                v-model:status="filters.status"
                :coaches="coaches"
                :courts="activeCourts"
                :sports="allowedSports"
              />
            </div>
          </MotionReveal>

          <MotionReveal :delay="0.1">
            <ScheduleAgenda
              v-if="view === 'agenda'"
              :sessions="filteredSessions"
              :timezone="timezone"
              :courts="courts"
              :coaches="coaches"
              :loading="loading"
              @select="onSelect"
            />
            <ScheduleCalendar
              v-else
              :sessions="filteredSessions"
              :timezone="timezone"
              :view="view === 'week' ? 'week' : 'day'"
              :anchor-at="anchorISO"
              :courts="visibleCourts"
              :coaches="coaches"
              :loading="loading"
              editable
              @select="onSelect"
              @create="onCreate"
              @move="onMove"
            />
            <p
              v-if="noMatches && view !== 'agenda'"
              class="mt-2 text-center text-sm text-muted"
            >
              {{ t('schedule.filters.empty') }}
            </p>
          </MotionReveal>
        </template>
      </div>

      <ScheduleFormSlideover
        v-model:open="formOpen"
        :courts="courts"
        :coaches="coaches"
        :allowed-sports="allowedSports"
        :timezone="timezone"
        :prefill="formPrefill"
        @saved="refresh()"
      />

      <ScheduleSessionSlideover
        v-model:open="detailOpen"
        :session="selected"
        :timezone="timezone"
        area="school"
        :courts="courts"
        :coaches="coaches"
        :students="students"
        @changed="refresh()"
        @edit="onEdit"
      />

      <ScheduleEditSlideover
        v-model:open="editOpen"
        :series-id="editSeriesId"
        :courts="courts"
        :coaches="coaches"
        @saved="refresh()"
      />
    </template>
  </UDashboardPanel>
</template>
