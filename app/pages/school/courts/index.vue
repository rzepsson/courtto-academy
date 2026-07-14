<script setup lang="ts">
import type { CourtView, CourtZoneView } from '~/utils/courts'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t } = useI18n()
const { toastError } = useApiError()

// Always fetch the full roster (archived included) — archived courts stay visible
// (dimmed, in their own section) rather than vanishing. Lazy so the shell renders
// instantly and the grid fills via skeletons.
const { data, status, refresh } = await useLazyFetch('/api/school/courts', {
  key: 'school:courts',
  query: { includeArchived: '1' }
})
// The facility's offered sports gate the builder (a court's discipline must be one).
const { data: profileData } = await useFetch('/api/school/profile', { key: 'school-profile' })
// Zones section the roster and feed the builder's grouping picker.
const { data: zonesData, refresh: refreshZones } = await useLazyFetch('/api/school/zones', { key: 'school:zones' })
const zones = computed<CourtZoneView[]>(() => zonesData.value?.zones ?? [])

const loading = computed(() => status.value === 'pending')
const allowedSports = computed(() => profileData.value?.profile.sports ?? [])
const hasSports = computed(() => allowedSports.value.length > 0)
const timezone = computed(() => profileData.value?.profile.timezone ?? 'Europe/Warsaw')

// `activeItems` is a mutable mirror so drag-reorder reflects instantly; archived
// courts are derived and never reordered.
const items = computed<CourtView[]>(() => data.value?.courts ?? [])
const activeItems = ref<CourtView[]>([])
watch(items, (value) => {
  activeItems.value = value.filter(c => c.archivedAt === null)
}, { immediate: true })
const archivedItems = computed(() => items.value.filter(c => c.archivedAt !== null))

const isEmpty = computed(() => !loading.value && items.value.length === 0)

function courtLink(court: CourtView): string {
  return `/school/courts/${court.id}`
}

// --- Builder ---
const builderOpen = ref(false)
const editing = ref<CourtView | null>(null)

function openCreate() {
  editing.value = null
  builderOpen.value = true
}

function openEdit(court: CourtView) {
  editing.value = court
  builderOpen.value = true
}

// Deep-link into the lesson calendar pre-filtered to this court.
function viewSchedule(court: CourtView) {
  navigateTo({ path: '/school/schedule', query: { court: court.id } })
}

// --- Maintenance / closure blocks ---
const blockOpen = ref(false)
const blockCourt = ref<CourtView | null>(null)

function openBlock(court: CourtView) {
  blockCourt.value = court
  blockOpen.value = true
}

// --- Lifecycle: archive (reversible) / restore / delete (permanent) ---
// The composable owns the HTTP + toast; this page re-fetches the roster on success.
const { purging, archive: archiveCourt, restore: restoreCourt, purge } = useCourtActions()

async function archive(court: CourtView) {
  if (await archiveCourt(court)) await refresh()
}
async function restore(court: CourtView) {
  if (await restoreCourt(court)) await refresh()
}

const courtToDelete = ref<CourtView | null>(null)
async function confirmDelete() {
  const court = courtToDelete.value
  if (!court) return
  const ok = await purge(court)
  courtToDelete.value = null
  if (ok) await refresh()
}

// --- Zone sections ---
const UNGROUPED = '__ungrouped__'

interface CourtSection { key: string, zone: CourtZoneView | null, courts: CourtView[] }

// Group the active roster by zone: named zones first (in their display order,
// empty ones omitted — they're managed in the slideover), then any ungrouped
// courts. Within a zone, courts keep their sortOrder (activeItems is sorted).
const sections = computed<CourtSection[]>(() => {
  const byZone = new Map<string, CourtView[]>()
  for (const c of activeItems.value) {
    const key = c.zoneId ?? UNGROUPED
    ;(byZone.get(key) ?? byZone.set(key, []).get(key)!).push(c)
  }
  const result: CourtSection[] = []
  for (const zone of zones.value) {
    const courts = byZone.get(zone.id)
    if (courts?.length) result.push({ key: zone.id, zone, courts })
  }
  const ungrouped = byZone.get(UNGROUPED)
  if (ungrouped?.length) result.push({ key: UNGROUPED, zone: null, courts: ungrouped })
  return result
})
// Headers only appear once there's a real grouping; a facility with no named
// zones (or all courts ungrouped) keeps the flat, header-less grid.
const showHeaders = computed(() => sections.value.some(s => s.zone !== null))

// --- Manage zones ---
const zonesOpen = ref(false)
async function onZonesChanged() {
  // A rename/reorder changes the sections; a delete ungroups courts — refetch both.
  await Promise.all([refreshZones(), refresh()])
}

// --- Drag reorder (within a zone section) ---
const canReorder = computed(() => activeItems.value.length > 1)
const drag = ref<{ key: string, index: number } | null>(null)
const over = ref<{ key: string, index: number } | null>(null)

function onDragStart(key: string, index: number) {
  if (canReorder.value) drag.value = { key, index }
}
function onDragEnter(key: string, index: number) {
  if (drag.value && drag.value.key === key) over.value = { key, index }
}
function onDragEnd() {
  drag.value = null
  over.value = null
}

// Reorder happens within a single section; the whole active order is then rebuilt
// (sections concatenated in display order) and persisted, so court sortOrder stays
// consistent with the grouped view. Cross-zone moves go through the edit form.
async function onDrop(key: string, target: number) {
  const from = drag.value
  drag.value = null
  over.value = null
  if (!from || from.key !== key || from.index === target) return

  const flat: CourtView[] = []
  for (const section of sections.value) {
    if (section.key !== key) {
      flat.push(...section.courts)
      continue
    }
    const courts = [...section.courts]
    const [moved] = courts.splice(from.index, 1)
    courts.splice(target, 0, moved!)
    flat.push(...courts)
  }
  activeItems.value = flat

  try {
    await $fetch('/api/school/courts/reorder', { method: 'PATCH', body: { ids: flat.map(c => c.id) } })
  } catch (error) {
    toastError('courts.errors.reorderFailed', error)
    await refresh()
  }
}
</script>

<template>
  <UDashboardPanel id="school-courts">
    <template #header>
      <UDashboardNavbar :title="t('nav.courts')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
          <UButton
            v-if="hasSports"
            color="neutral"
            variant="subtle"
            size="md"
            icon="i-lucide-layout-grid"
            :label="t('courts.zones.manage')"
            @click="zonesOpen = true"
          />
          <PressButton
            v-if="hasSports"
            :block="false"
            size="md"
            icon="i-lucide-plus"
            :label="t('courts.add')"
            @click="openCreate"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <MotionReveal>
          <p class="max-w-2xl text-sm text-muted">
            {{ t('courts.tagline') }}
          </p>
        </MotionReveal>

        <!-- Loading -->
        <div
          v-if="loading"
          class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <USkeleton
            v-for="i in 6"
            :key="i"
            class="h-52 w-full rounded-xl"
          />
        </div>

        <!-- No sports declared yet -->
        <MotionReveal v-else-if="!hasSports">
          <div class="flex flex-col items-center rounded-xl border border-dashed border-default py-16 text-center">
            <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-list-checks"
                class="size-6 text-dimmed"
              />
            </div>
            <p class="mt-4 text-sm font-medium text-highlighted">
              {{ t('courts.noSports.title') }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-muted">
              {{ t('courts.noSports.description') }}
            </p>
            <UButton
              class="mt-5"
              color="neutral"
              variant="subtle"
              icon="i-lucide-settings"
              :label="t('courts.noSports.action')"
              to="/school/settings"
            />
          </div>
        </MotionReveal>

        <!-- Empty roster -->
        <MotionReveal v-else-if="isEmpty">
          <div class="flex flex-col items-center rounded-xl border border-dashed border-default py-16 text-center">
            <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-land-plot"
                class="size-6 text-dimmed"
              />
            </div>
            <p class="mt-4 text-sm font-medium text-highlighted">
              {{ t('courts.empty.title') }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-muted">
              {{ t('courts.empty.description') }}
            </p>
            <PressButton
              class="mt-5"
              :block="false"
              size="md"
              icon="i-lucide-plus"
              :label="t('courts.add')"
              @click="openCreate"
            />
          </div>
        </MotionReveal>

        <template v-else>
          <!-- Active roster, grouped into zone sections (drag-reorder within a zone) -->
          <div
            v-if="activeItems.length"
            class="flex flex-col gap-6"
          >
            <MotionReveal
              v-for="(section, si) in sections"
              :key="section.key"
              :delay="Math.min(si * 0.05, 0.2)"
            >
              <div class="flex flex-col gap-3">
                <div
                  v-if="showHeaders"
                  class="flex items-center gap-2"
                >
                  <UIcon
                    :name="section.zone ? 'i-lucide-layout-grid' : 'i-lucide-shapes'"
                    class="size-4 text-dimmed"
                  />
                  <h2 class="text-sm font-semibold text-highlighted">
                    {{ section.zone ? section.zone.name : t('courts.zones.ungrouped') }}
                  </h2>
                  <UBadge
                    :label="String(section.courts.length)"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                  />
                </div>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div
                    v-for="(court, index) in section.courts"
                    :key="court.id"
                    :draggable="canReorder"
                    class="h-full transition-transform"
                    :class="[
                      canReorder && 'cursor-move',
                      drag && drag.key === section.key && drag.index === index && 'opacity-50',
                      over && over.key === section.key && over.index === index && drag && drag.index !== index && 'scale-[1.02]'
                    ]"
                    @dragstart="onDragStart(section.key, index)"
                    @dragenter.prevent="onDragEnter(section.key, index)"
                    @dragover.prevent
                    @drop="onDrop(section.key, index)"
                    @dragend="onDragEnd"
                  >
                    <CourtsCard
                      :court="court"
                      :to="courtLink(court)"
                      menu
                      schedule-action
                      block-action
                      @edit="openEdit(court)"
                      @archive="archive(court)"
                      @delete="courtToDelete = court"
                      @schedule="viewSchedule(court)"
                      @block="openBlock(court)"
                    />
                  </div>
                </div>
              </div>
            </MotionReveal>
          </div>

          <!-- Only archived courts remain -->
          <MotionReveal v-else>
            <div class="flex flex-col items-center rounded-xl border border-dashed border-default py-10 text-center">
              <p class="text-sm text-muted">
                {{ t('courts.noActive') }}
              </p>
              <PressButton
                class="mt-4"
                :block="false"
                size="md"
                icon="i-lucide-plus"
                :label="t('courts.add')"
                @click="openCreate"
              />
            </div>
          </MotionReveal>

          <!-- Archived section: kept for history, dimmed, restore or delete -->
          <MotionReveal
            v-if="archivedItems.length"
            :delay="0.1"
          >
            <div class="mt-2 flex flex-col gap-4">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-archive"
                  class="size-4 text-dimmed"
                />
                <h2 class="text-sm font-medium text-muted">
                  {{ t('courts.archivedSection.title') }}
                </h2>
                <UBadge
                  :label="String(archivedItems.length)"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="-mt-2 text-xs text-dimmed">
                {{ t('courts.archivedSection.hint') }}
              </p>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <CourtsCard
                  v-for="court in archivedItems"
                  :key="court.id"
                  :court="court"
                  :to="courtLink(court)"
                  menu
                  @restore="restore(court)"
                  @delete="courtToDelete = court"
                />
              </div>
            </div>
          </MotionReveal>
        </template>
      </div>

      <SchoolCourtsFormSlideover
        v-model:open="builderOpen"
        :court="editing"
        :allowed-sports="allowedSports"
        :zones="zones"
        @saved="refresh()"
      />

      <SchoolCourtsZonesSlideover
        v-model:open="zonesOpen"
        @changed="onZonesChanged"
      />

      <SchoolCourtsBlockSlideover
        v-model:open="blockOpen"
        :court="blockCourt"
        :timezone="timezone"
      />

      <UModal
        :open="courtToDelete !== null"
        :title="t('courts.deleteConfirm.title')"
        :description="t('courts.deleteConfirm.description', { name: courtToDelete?.name })"
        @update:open="(value: boolean) => { if (!value) courtToDelete = null }"
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
              @click="courtToDelete = null"
            />
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="purging"
              :label="t('courts.actions.delete')"
              @click="confirmDelete"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
