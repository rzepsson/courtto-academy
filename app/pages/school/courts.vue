<script setup lang="ts">
import type { CourtView } from '~/utils/courts'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t } = useI18n()
const toast = useToast()
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

const loading = computed(() => status.value === 'pending')
const allowedSports = computed(() => profileData.value?.profile.sports ?? [])
const hasSports = computed(() => allowedSports.value.length > 0)

// `activeItems` is a mutable mirror so drag-reorder reflects instantly; archived
// courts are derived and never reordered.
const items = computed<CourtView[]>(() => data.value?.courts ?? [])
const activeItems = ref<CourtView[]>([])
watch(items, (value) => {
  activeItems.value = value.filter(c => c.archivedAt === null)
}, { immediate: true })
const archivedItems = computed(() => items.value.filter(c => c.archivedAt !== null))

const isEmpty = computed(() => !loading.value && items.value.length === 0)

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

// --- Lifecycle: archive (reversible) / restore / delete (permanent) ---
async function archive(court: CourtView) {
  const endpoint: string = `/api/school/courts/${court.id}`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('courts.archived'), color: 'neutral' })
    await refresh()
  } catch (error) {
    toastError('courts.errors.archiveFailed', error)
  }
}

async function restore(court: CourtView) {
  try {
    await $fetch(`/api/school/courts/${court.id}`, { method: 'PATCH', body: { restore: true } })
    toast.add({ title: t('courts.restored'), color: 'success' })
    await refresh()
  } catch (error) {
    toastError('courts.errors.restoreFailed', error)
  }
}

const courtToDelete = ref<CourtView | null>(null)
const deleting = ref(false)

async function confirmDelete() {
  if (!courtToDelete.value) {
    return
  }
  deleting.value = true
  // Annotated string so typed $fetch doesn't intersect this dynamic path with the
  // sibling /courts/reorder route (which would forbid DELETE).
  const endpoint: string = `/api/school/courts/${courtToDelete.value.id}?purge=1`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('courts.deleted'), color: 'neutral' })
    await refresh()
  } catch (error) {
    toastError('courts.errors.deleteFailed', error)
  } finally {
    deleting.value = false
    courtToDelete.value = null
  }
}

// --- Drag reorder (active courts only) ---
const canReorder = computed(() => activeItems.value.length > 1)
const dragIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)

function onDragStart(index: number) {
  if (!canReorder.value) {
    return
  }
  dragIndex.value = index
}

function onDragEnter(index: number) {
  if (dragIndex.value !== null) {
    overIndex.value = index
  }
}

async function onDrop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  overIndex.value = null
  if (from === null || from === target) {
    return
  }

  const next = [...activeItems.value]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved!)
  activeItems.value = next

  try {
    await $fetch('/api/school/courts/reorder', {
      method: 'PATCH',
      body: { ids: activeItems.value.map(c => c.id) }
    })
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
          <!-- Active roster grid (drag-reorderable) -->
          <div
            v-if="activeItems.length"
            class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <MotionReveal
              v-for="(court, index) in activeItems"
              :key="court.id"
              :delay="Math.min(index * 0.04, 0.24)"
              class="h-full"
            >
              <div
                :draggable="canReorder"
                class="h-full transition-transform"
                :class="[
                  canReorder && 'cursor-move',
                  dragIndex === index && 'opacity-50',
                  overIndex === index && dragIndex !== null && dragIndex !== index && 'scale-[1.02]'
                ]"
                @dragstart="onDragStart(index)"
                @dragenter.prevent="onDragEnter(index)"
                @dragover.prevent
                @drop="onDrop(index)"
                @dragend="dragIndex = null; overIndex = null"
              >
                <CourtsCard
                  :court="court"
                  menu
                  @edit="openEdit(court)"
                  @archive="archive(court)"
                  @delete="courtToDelete = court"
                />
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
        @saved="refresh()"
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
              :loading="deleting"
              :label="t('courts.actions.delete')"
              @click="confirmDelete"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
