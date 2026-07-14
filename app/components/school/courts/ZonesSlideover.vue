<script setup lang="ts">
import type { CourtZoneView } from '~/utils/courts'
import { COURT_LIMITS } from '~~/shared/courts'

// Manage a facility's zones (areas/halls): create, rename, drag-reorder, delete.
// Shares the 'school:zones' fetch with the roster, so a change here reflects there
// immediately; `changed` also nudges the parent to refetch courts (a delete
// ungroups them). Deleting a zone never deletes its courts — they just ungroup.
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const { data, refresh } = await useLazyFetch('/api/school/zones', { key: 'school:zones' })
// A deep-copied mirror so inline rename edits + drag reorder are local until saved.
const items = ref<CourtZoneView[]>([])
watch(() => data.value?.zones, (value) => {
  items.value = (value ?? []).map(z => ({ ...z }))
}, { immediate: true })

const nameMax = COURT_LIMITS.zoneName

// --- Create ---
const newName = ref('')
const creating = ref(false)
async function createZone() {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    await $fetch('/api/school/zones', { method: 'POST', body: { name } })
    newName.value = ''
    await refresh()
    emit('changed')
  } catch (error) {
    toastError('courts.zones.errors.createFailed', error)
  } finally {
    creating.value = false
  }
}

// --- Rename (on blur/enter; a no-op or empty value reverts) ---
async function renameZone(zone: CourtZoneView) {
  const name = zone.name.trim()
  if (!name) {
    await refresh()
    return
  }
  const endpoint: string = `/api/school/zones/${zone.id}`
  try {
    await $fetch(endpoint, { method: 'PATCH', body: { name } })
    await refresh()
    emit('changed')
  } catch (error) {
    toastError('courts.zones.errors.renameFailed', error)
    await refresh()
  }
}

// --- Delete (confirmed — it ungroups the zone's courts) ---
const zoneToDelete = ref<CourtZoneView | null>(null)
const deleting = ref(false)
async function confirmDelete() {
  const zone = zoneToDelete.value
  if (!zone) return
  deleting.value = true
  const endpoint: string = `/api/school/zones/${zone.id}`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('courts.zones.deleted'), color: 'neutral' })
    zoneToDelete.value = null
    await refresh()
    emit('changed')
  } catch (error) {
    toastError('courts.zones.errors.deleteFailed', error)
  } finally {
    deleting.value = false
  }
}

// --- Drag reorder ---
const canReorder = computed(() => items.value.length > 1)
const dragIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)

function onDragStart(index: number) {
  if (canReorder.value) dragIndex.value = index
}
function onDragEnter(index: number) {
  if (dragIndex.value !== null) overIndex.value = index
}
async function onDrop(target: number) {
  const from = dragIndex.value
  dragIndex.value = null
  overIndex.value = null
  if (from === null || from === target) return

  const next = [...items.value]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved!)
  items.value = next

  try {
    await $fetch('/api/school/zones/reorder', { method: 'PATCH', body: { ids: next.map(z => z.id) } })
    await refresh()
    emit('changed')
  } catch (error) {
    toastError('courts.zones.errors.reorderFailed', error)
    await refresh()
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('courts.zones.title')"
    :description="t('courts.zones.subtitle')"
    :ui="{ content: 'max-w-md w-full' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <form
          class="flex items-end gap-2"
          @submit.prevent="createZone"
        >
          <UFormField
            :label="t('courts.zones.newLabel')"
            class="flex-1"
          >
            <UInput
              v-model="newName"
              :maxlength="nameMax"
              :placeholder="t('courts.zones.namePlaceholder')"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <PressButton
            type="submit"
            :block="false"
            size="md"
            icon="i-lucide-plus"
            :label="t('courts.zones.add')"
            :loading="creating"
            :disabled="!newName.trim()"
          />
        </form>

        <p
          v-if="items.length === 0"
          class="rounded-lg bg-elevated/40 px-4 py-6 text-center text-sm text-muted"
        >
          {{ t('courts.zones.empty') }}
        </p>
        <ul
          v-else
          class="flex flex-col gap-2"
        >
          <li
            v-for="(zone, index) in items"
            :key="zone.id"
            :draggable="canReorder"
            class="flex items-center gap-2 rounded-lg bg-default p-2 ring-1 ring-default transition-transform"
            :class="[
              canReorder && 'cursor-move',
              dragIndex === index && 'opacity-50',
              overIndex === index && dragIndex !== null && dragIndex !== index && 'scale-[1.01]'
            ]"
            @dragstart="onDragStart(index)"
            @dragenter.prevent="onDragEnter(index)"
            @dragover.prevent
            @drop="onDrop(index)"
            @dragend="dragIndex = null; overIndex = null"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="size-4 shrink-0 text-dimmed"
            />
            <UInput
              v-model="zone.name"
              :maxlength="nameMax"
              variant="none"
              class="min-w-0 flex-1 font-medium"
              @change="renameZone(zone)"
              @keydown.enter="(e: KeyboardEvent) => (e.target as HTMLInputElement).blur()"
            />
            <UBadge
              :label="t('courts.zones.courtCount', { n: zone.courtCount })"
              color="neutral"
              variant="subtle"
              size="sm"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-trash-2"
              :aria-label="t('courts.zones.delete')"
              class="text-dimmed hover:text-error"
              @click="zoneToDelete = zone"
            />
          </li>
        </ul>
      </div>
    </template>
  </USlideover>

  <UModal
    :open="zoneToDelete !== null"
    :title="t('courts.zones.deleteConfirm.title')"
    :description="t('courts.zones.deleteConfirm.description', { name: zoneToDelete?.name })"
    @update:open="(value: boolean) => { if (!value) zoneToDelete = null }"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="zoneToDelete = null"
        />
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="deleting"
          :label="t('courts.zones.delete')"
          @click="confirmDelete"
        />
      </div>
    </template>
  </UModal>
</template>
