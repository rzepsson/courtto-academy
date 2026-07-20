<script setup lang="ts">
import { DateTime } from 'luxon'
import { canMemberCoach } from '~~/shared/member-profile'
import type { CourtView } from '~/utils/courts'
import type { ScheduleSessionView } from '~/utils/schedule'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const route = useRoute()
const router = useRouter()

// A `?court=<id>[,<id>]` deep-link (e.g. from the courts panel) seeds the court
// filter. Comma-separated so it round-trips a multi-court selection.
function parseCourtQuery(): string[] {
  const raw = Array.isArray(route.query.court) ? route.query.court[0] : route.query.court
  return raw ? String(raw).split(',').filter(Boolean) : []
}

const { data: profileData } = await useFetch('/api/school/profile', { key: 'school-profile' })
const { data: courtsData } = await useLazyFetch('/api/school/courts', { key: 'school:courts' })
const { data: membersData } = await useLazyFetch('/api/school/members', { key: 'school:members' })
const { data: zonesData } = await useLazyFetch('/api/school/zones', { key: 'school:zones' })

const timezone = computed(() => profileData.value?.profile.timezone ?? 'Europe/Warsaw')
const allowedSports = computed(() => profileData.value?.profile.sports ?? [])
const courts = computed<CourtView[]>(() => courtsData.value?.courts ?? [])
const activeCourts = computed(() => courts.value.filter(c => c.archivedAt === null))
const zones = computed(() => zonesData.value?.zones ?? [])
// Resolve a session/block/court's zone for the zone filter (the zone lives on the court).
const zoneByCourtId = computed(() => new Map(courts.value.map(c => [c.id, c.zoneId])))
// Only active members who are set up to coach (role `coach`, or an owner/admin
// granted the capability) are assignable — mirrors the server's requireCoach.
const coaches = computed(() =>
  (membersData.value ?? [])
    .filter(m => m.status === 'active' && canMemberCoach(m))
    .map(m => ({ id: m.id, name: m.user.name }))
)
const students = computed(() =>
  (membersData.value ?? [])
    .filter(m => m.role === 'student' && m.status === 'active')
    .map(m => ({ id: m.id, name: m.user.name, email: m.user.email }))
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
const blocks = computed<CourtBlockView[]>(() => sessionsData.value?.blocks ?? [])
const loading = computed(() => status.value === 'pending')

// Client-side filters over the already-fetched window — instant, no refetch.
const filters = reactive<ScheduleFilterState>({ coachMemberIds: [], courtIds: parseCourtQuery(), zoneIds: [], sports: [], types: [], status: 'all' })

// Drop any seeded court id that isn't an active court (archived/removed since the
// link was made), so a stale deep-link degrades to "all courts" instead of an
// empty grid. Runs once the roster resolves.
watch(activeCourts, (list) => {
  if (!filters.courtIds.length || !list.length) return
  const valid = new Set(list.map(c => c.id))
  const pruned = filters.courtIds.filter(id => valid.has(id))
  if (pruned.length !== filters.courtIds.length) filters.courtIds = pruned
})

// Mirror the court filter into the URL so the view is shareable/bookmarkable and
// the deep-link param clears when the filter is emptied.
watch(() => filters.courtIds.slice(), (ids) => {
  const query = { ...route.query }
  if (ids.length) query.court = ids.join(',')
  else delete query.court
  router.replace({ query })
})
const filteredSessions = computed(() => sessions.value.filter(s => sessionMatchesFilters(s, filters, zoneByCourtId.value)))
// Blocks respect the court + zone filters (the coach/type/sport/status filters are
// lesson concepts that don't apply to a maintenance closure).
const filteredBlocks = computed(() => blocks.value.filter(b =>
  (!filters.courtIds.length || filters.courtIds.includes(b.courtId))
  && courtMatchesZones(b.courtId, filters.zoneIds, zoneByCourtId.value)
))
// The court + zone filters also narrow the day-view columns, not just the blocks.
const visibleCourts = computed(() => activeCourts.value.filter(c =>
  (!filters.courtIds.length || filters.courtIds.includes(c.id))
  && courtMatchesZones(c.id, filters.zoneIds, zoneByCourtId.value)
))
const noMatches = computed(() => !loading.value && sessions.value.length > 0 && filteredSessions.value.length === 0)

// --- Slideovers ---
const formOpen = ref(false)
const formPrefill = ref<{ startLocal: string, courtId: string | null, sport?: string } | null>(null)
const detailOpen = ref(false)
const selected = ref<ScheduleSessionView | null>(null)

function openCreate() {
  formPrefill.value = null
  formOpen.value = true
}
function onCreate(payload: { startLocal: string, courtId: string | null }) {
  formPrefill.value = { ...payload, sport: activeCourts.value.find(c => c.id === payload.courtId)?.sport }
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

// --- Maintenance / closure blocks ---
const selectedBlock = ref<CourtBlockView | null>(null)
const blockDetailOpen = computed({
  get: () => selectedBlock.value !== null,
  set: (value: boolean) => { if (!value) selectedBlock.value = null }
})
const deletingBlock = ref(false)

function onSelectBlock(block: CourtBlockView) {
  selectedBlock.value = block
}

const blockCourtName = computed(() =>
  courts.value.find(c => c.id === selectedBlock.value?.courtId)?.name ?? t('schedule.calendar.otherCourt')
)
const blockRangeText = computed(() =>
  selectedBlock.value
    ? courtBlockRangeLabel(selectedBlock.value.startsAt, selectedBlock.value.endsAt, timezone.value, locale.value)
    : ''
)

async function deleteBlock() {
  const block = selectedBlock.value
  if (!block) return
  deletingBlock.value = true
  const endpoint: string = `/api/school/courts/${block.courtId}/blocks/${block.id}`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('schedule.blocks.removed'), color: 'neutral' })
    selectedBlock.value = null
    await refresh()
  } catch (error) {
    toastError('schedule.blocks.errors.removeFailed', error)
  } finally {
    deletingBlock.value = false
  }
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
                v-model:zone-ids="filters.zoneIds"
                v-model:selected-sports="filters.sports"
                v-model:types="filters.types"
                v-model:status="filters.status"
                :coaches="coaches"
                :courts="activeCourts"
                :zones="zones"
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
              :blocks="filteredBlocks"
              :loading="loading"
              editable
              @select="onSelect"
              @select-block="onSelectBlock"
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

      <UModal
        v-model:open="blockDetailOpen"
        :title="t('schedule.blocks.detail.title')"
      >
        <template #body>
          <div class="flex flex-col gap-4">
            <div class="flex items-start gap-3">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <UIcon
                  name="i-lucide-wrench"
                  class="size-4"
                />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-highlighted">
                  {{ selectedBlock?.title || t(`schedule.blocks.kinds.${selectedBlock?.kind}`) }}
                </p>
                <p class="text-sm text-muted">
                  {{ blockCourtName }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2 rounded-lg bg-elevated/40 px-3 py-2 text-sm text-muted ring-1 ring-default">
              <UIcon
                name="i-lucide-calendar-clock"
                class="size-4 shrink-0 text-dimmed"
              />
              {{ blockRangeText }}
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.close')"
              @click="blockDetailOpen = false"
            />
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="deletingBlock"
              :label="t('schedule.blocks.detail.remove')"
              @click="deleteBlock"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
