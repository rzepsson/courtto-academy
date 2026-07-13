<script setup lang="ts">
import { DateTime } from 'luxon'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CourtView } from '~/utils/courts'
import type { ScheduleSessionView, CourtBlockView } from '~/utils/schedule'

// Per-court cockpit: overview + this court's schedule + its maintenance windows.
// The hub the roster tile, the "view in schedule" deep-link and the block
// slideover all point at. Deliberately NOT a second lesson editor — creating /
// editing lessons stays on /school/schedule (reached via "Open in schedule");
// here the calendar is a focused, read-only view of this court, and the only
// mutation owned by the page is its own maintenance blocks.
definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const route = useRoute()
const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const courtId = computed(() => route.params.id as string)

// --- Data ---
// A dynamic URL matches several typed routes, so the response type is annotated
// explicitly (rather than inferred as a union of every /courts/* handler).
const { data: courtData, error: courtError, refresh: refreshCourt } = await useFetch<{ court: CourtView }>(
  () => `/api/school/courts/${courtId.value}`,
  { key: 'court-detail' }
)
const court = computed<CourtView | null>(() => courtData.value?.court ?? null)
const archived = computed(() => court.value?.archivedAt != null)

const { data: profileData } = await useFetch('/api/school/profile', { key: 'school-profile' })
const timezone = computed(() => profileData.value?.profile.timezone ?? 'Europe/Warsaw')
const allowedSports = computed(() => profileData.value?.profile.sports ?? [])

const { data: membersData } = await useLazyFetch('/api/school/members', { key: 'school:members' })
const coaches = computed(() =>
  (membersData.value ?? []).filter(m => m.role !== 'student').map(m => ({ id: m.id, name: m.user.name }))
)
const students = computed(() =>
  (membersData.value ?? []).filter(m => m.role === 'student').map(m => ({ id: m.id, name: m.user.name, email: m.user.email }))
)

// The active roster feeds the create form + the reschedule court picker (the same
// data the schedule page passes), so scheduling on this court behaves identically.
const { data: courtsData } = await useLazyFetch('/api/school/courts', { key: 'school:courts' })
const activeCourts = computed<CourtView[]>(() => (courtsData.value?.courts ?? []).filter(c => c.archivedAt === null))

// This court's calendar window (day/week), server-filtered to the court.
const view = ref<ScheduleView>('day')
const anchorISO = ref(new Date().toISOString())
const range = computed(() => {
  const anchor = DateTime.fromISO(anchorISO.value, { zone: timezone.value })
  return view.value === 'day' ? dayRange(anchor) : weekRange(anchor)
})
const { data: scheduleData, status: scheduleStatus, refresh: refreshSchedule } = await useLazyFetch<{
  sessions: ScheduleSessionView[]
  blocks: CourtBlockView[]
}>(
  () => `/api/school/courts/${courtId.value}/schedule`,
  { key: 'court-detail:schedule', query: computed(() => ({ from: range.value.from, to: range.value.to })) }
)
const sessions = computed<ScheduleSessionView[]>(() => scheduleData.value?.sessions ?? [])
const calendarBlocks = computed<CourtBlockView[]>(() => scheduleData.value?.blocks ?? [])
const scheduleLoading = computed(() => scheduleStatus.value === 'pending')

// Upcoming maintenance/closures — a forward window, independent of calendar nav.
const { data: blocksData, refresh: refreshBlocks } = await useLazyFetch<{ blocks: CourtBlockView[] }>(
  () => `/api/school/courts/${courtId.value}/blocks`,
  { key: 'court-detail:blocks' }
)
const upcomingBlocks = computed<CourtBlockView[]>(() => blocksData.value?.blocks ?? [])

const columns = computed<CourtView[]>(() => (court.value ? [court.value] : []))
const metaParts = computed(() => (court.value ? courtMetaParts(court.value, t) : []))
const unitLabel = computed(() => (court.value ? courtUnitLabel(court.value.sport, t) : ''))
const addedOn = computed(() =>
  court.value ? DateTime.fromISO(court.value.createdAt, { zone: timezone.value }).setLocale(locale.value).toFormat('d LLLL yyyy') : ''
)

async function refreshBlockViews() {
  await Promise.all([refreshSchedule(), refreshBlocks()])
}

// --- Court lifecycle (shared composable; page decides post-action) ---
const { purging, archive: archiveCourt, restore: restoreCourt, purge } = useCourtActions()

async function onArchive() {
  if (court.value && await archiveCourt(court.value)) await refreshCourt()
}
async function onRestore() {
  if (court.value && await restoreCourt(court.value)) await refreshCourt()
}

const deleteOpen = ref(false)
async function onDelete() {
  if (!court.value) return
  const ok = await purge(court.value)
  deleteOpen.value = false
  if (ok) await navigateTo('/school/courts')
}

// --- Edit ---
const editOpen = ref(false)

// --- Session detail (reuses the schedule slideover; whole-series edits route to
// the full schedule, which owns that heavier flow) ---
const detailOpen = ref(false)
const selected = ref<ScheduleSessionView | null>(null)
function onSelect(session: ScheduleSessionView) {
  selected.value = session
  detailOpen.value = true
}
function onEditSeries() {
  detailOpen.value = false
  navigateTo({ path: '/school/schedule', query: { court: courtId.value } })
}

// --- Create a lesson on this court (in-place; reuses the schedule builder) ---
const formOpen = ref(false)
const formPrefill = ref<{ startLocal?: string, courtId: string | null, sport?: string } | null>(null)

function openCreate(payload?: { startLocal: string, courtId: string | null }) {
  if (!court.value) return
  // Always this court (we're on its page); a clicked slot supplies the time.
  formPrefill.value = { startLocal: payload?.startLocal, courtId: court.value.id, sport: court.value.sport }
  formOpen.value = true
}

// Drag-to-move a single occurrence (same PATCH as the schedule page); a no-op
// drop is filtered by the calendar, so this only fires on a real reschedule.
async function onMove({ session, startLocal, courtId: targetCourtId }: { session: ScheduleSessionView, startLocal: string, courtId: string | null }) {
  const endpoint: string = `/api/school/schedule/sessions/${session.id}`
  try {
    await $fetch(endpoint, { method: 'PATCH', body: { startsAt: startLocal, courtId: targetCourtId || undefined } })
  } catch (error) {
    toastError('schedule.errors.moveFailed', error)
  } finally {
    await refreshSchedule()
  }
}

// --- Maintenance blocks ---
const blockOpen = ref(false)
const blockToRemove = ref<CourtBlockView | null>(null)
const removingBlock = ref(false)

function blockLabel(block: CourtBlockView): string {
  return block.title || t(`schedule.blocks.kinds.${block.kind}`)
}
function blockRange(block: CourtBlockView): string {
  return courtBlockRangeLabel(block.startsAt, block.endsAt, timezone.value, locale.value)
}

async function removeBlock() {
  const block = blockToRemove.value
  if (!block) return
  removingBlock.value = true
  const endpoint: string = `/api/school/courts/${block.courtId}/blocks/${block.id}`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('schedule.blocks.removed'), color: 'neutral' })
    blockToRemove.value = null
    await refreshBlockViews()
  } catch (error) {
    toastError('schedule.blocks.errors.removeFailed', error)
  } finally {
    removingBlock.value = false
  }
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const lifecycle: DropdownMenuItem[] = archived.value
    ? [{ label: t('courts.actions.restore'), icon: 'i-lucide-rotate-ccw', onSelect: onRestore }]
    : [
        { label: t('courts.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => { editOpen.value = true } },
        { label: t('courts.actions.archive'), icon: 'i-lucide-archive', onSelect: onArchive }
      ]
  return [lifecycle, [{
    label: t('courts.actions.delete'),
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { deleteOpen.value = true }
  }]]
})
</script>

<template>
  <UDashboardPanel id="school-court-detail">
    <template #header>
      <UDashboardNavbar :title="court?.name ?? t('courts.detail.title')">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            to="/school/courts"
            :aria-label="t('courts.detail.back')"
          />
        </template>
        <template #right>
          <AppHeaderControls />
          <template v-if="court">
            <PressButton
              v-if="!archived"
              :block="false"
              size="md"
              icon="i-lucide-plus"
              :label="t('schedule.add')"
              @click="openCreate()"
            />
            <UDropdownMenu
              :items="menuItems"
              :content="{ align: 'end' }"
            >
              <UButton
                color="neutral"
                variant="ghost"
                square
                icon="i-lucide-ellipsis"
                :aria-label="t('courts.actions.menu')"
              />
            </UDropdownMenu>
          </template>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Not found -->
      <MotionReveal v-if="courtError">
        <div class="flex flex-col items-center rounded-xl border border-dashed border-default py-16 text-center">
          <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
            <UIcon
              name="i-lucide-search-x"
              class="size-6 text-dimmed"
            />
          </div>
          <p class="mt-4 text-sm font-medium text-highlighted">
            {{ t('courts.detail.notFound.title') }}
          </p>
          <p class="mt-1 max-w-sm text-sm text-muted">
            {{ t('courts.detail.notFound.description') }}
          </p>
          <UButton
            class="mt-5"
            color="neutral"
            variant="subtle"
            icon="i-lucide-arrow-left"
            :label="t('courts.detail.notFound.action')"
            to="/school/courts"
          />
        </div>
      </MotionReveal>

      <div
        v-else-if="court"
        class="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        <!-- Left column: overview + maintenance -->
        <div class="flex flex-col gap-6 lg:col-span-1">
          <MotionReveal>
            <div
              class="overflow-hidden rounded-xl bg-default ring-1 ring-default"
              :class="archived && 'opacity-75'"
            >
              <div class="aspect-16/10 w-full bg-elevated">
                <CourtsDiagram
                  :sport="court.sport"
                  :surface-color="court.surfaceColor"
                  :line-color="court.lineColor"
                />
              </div>
              <div class="flex flex-col gap-3 p-4">
                <div class="flex flex-wrap items-center gap-1.5">
                  <UBadge
                    v-if="archived"
                    :label="t('courts.archivedBadge')"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    icon="i-lucide-archive"
                  />
                  <UBadge
                    :label="unitLabel"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                  />
                </div>
                <p class="text-sm text-muted">
                  {{ metaParts.join(' · ') }}
                </p>
                <p
                  v-if="court.notes"
                  class="border-t border-default pt-3 text-sm text-muted"
                >
                  {{ court.notes }}
                </p>
                <p class="text-xs text-dimmed">
                  {{ t('courts.detail.added', { date: addedOn }) }}
                </p>
              </div>
            </div>
          </MotionReveal>

          <!-- Maintenance & closures -->
          <MotionReveal :delay="0.05">
            <div class="flex flex-col gap-3 rounded-xl bg-default p-4 ring-1 ring-default">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-wrench"
                    class="size-4 text-dimmed"
                  />
                  <h2 class="text-sm font-semibold text-highlighted">
                    {{ t('courts.detail.maintenance.title') }}
                  </h2>
                </div>
                <UButton
                  v-if="!archived"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  icon="i-lucide-plus"
                  :label="t('courts.detail.maintenance.add')"
                  @click="blockOpen = true"
                />
              </div>

              <p
                v-if="upcomingBlocks.length === 0"
                class="rounded-lg bg-elevated/40 px-3 py-4 text-center text-sm text-muted"
              >
                {{ t('courts.detail.maintenance.empty') }}
              </p>
              <ul
                v-else
                class="flex flex-col divide-y divide-default"
              >
                <li
                  v-for="block in upcomingBlocks"
                  :key="block.id"
                  class="flex items-center gap-3 py-2.5"
                >
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                    <UIcon
                      name="i-lucide-wrench"
                      class="size-4"
                    />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ blockLabel(block) }}
                    </p>
                    <p class="truncate text-xs text-muted">
                      {{ blockRange(block) }}
                    </p>
                  </div>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    icon="i-lucide-x"
                    :aria-label="t('schedule.blocks.detail.remove')"
                    @click="blockToRemove = block"
                  />
                </li>
              </ul>
            </div>
          </MotionReveal>
        </div>

        <!-- Right column: this court's schedule -->
        <div class="flex flex-col gap-3 lg:col-span-2">
          <MotionReveal :delay="0.1">
            <ScheduleToolbar
              v-model:view="view"
              v-model:anchor-at="anchorISO"
              :timezone="timezone"
            />
          </MotionReveal>

          <MotionReveal :delay="0.15">
            <ScheduleAgenda
              v-if="view === 'agenda'"
              :sessions="sessions"
              :timezone="timezone"
              :courts="columns"
              :coaches="coaches"
              :loading="scheduleLoading"
              @select="onSelect"
            />
            <ScheduleCalendar
              v-else
              :sessions="sessions"
              :timezone="timezone"
              :view="view === 'week' ? 'week' : 'day'"
              :anchor-at="anchorISO"
              :courts="columns"
              :coaches="coaches"
              :blocks="calendarBlocks"
              :loading="scheduleLoading"
              :editable="!archived"
              @select="onSelect"
              @select-block="blockToRemove = $event"
              @create="openCreate"
              @move="onMove"
            />
          </MotionReveal>
        </div>
      </div>

      <!-- Slideovers & dialogs -->
      <SchoolCourtsFormSlideover
        v-model:open="editOpen"
        :court="court"
        :allowed-sports="allowedSports"
        @saved="refreshCourt()"
      />

      <SchoolCourtsBlockSlideover
        v-model:open="blockOpen"
        :court="court"
        :timezone="timezone"
        @saved="refreshBlockViews()"
      />

      <ScheduleFormSlideover
        v-model:open="formOpen"
        :courts="activeCourts"
        :coaches="coaches"
        :allowed-sports="allowedSports"
        :timezone="timezone"
        :prefill="formPrefill"
        lock-court
        @saved="refreshSchedule()"
      />

      <ScheduleSessionSlideover
        v-model:open="detailOpen"
        :session="selected"
        :timezone="timezone"
        area="school"
        :courts="activeCourts"
        :coaches="coaches"
        :students="students"
        @changed="refreshSchedule()"
        @edit="onEditSeries"
      />

      <UModal
        :open="blockToRemove !== null"
        :title="t('schedule.blocks.detail.title')"
        @update:open="(value: boolean) => { if (!value) blockToRemove = null }"
      >
        <template #body>
          <div class="flex items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <UIcon
                name="i-lucide-wrench"
                class="size-4"
              />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-highlighted">
                {{ blockToRemove ? blockLabel(blockToRemove) : '' }}
              </p>
              <p class="text-sm text-muted">
                {{ blockToRemove ? blockRange(blockToRemove) : '' }}
              </p>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="blockToRemove = null"
            />
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="removingBlock"
              :label="t('schedule.blocks.detail.remove')"
              @click="removeBlock"
            />
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="deleteOpen"
        :title="t('courts.deleteConfirm.title')"
        :description="t('courts.deleteConfirm.description', { name: court?.name })"
      >
        <template #body>
          <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="t('courts.deleteConfirm.warningTitle')"
            :description="t('courts.deleteConfirm.warningBody')"
          />
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="deleteOpen = false"
            />
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="purging"
              :label="t('courts.actions.delete')"
              @click="onDelete"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
