<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { INVITABLE_ROLES } from '~~/shared/permissions'
import type { InvitableRole } from '~~/shared/permissions'
import {
  MEMBER_DIRECTORY_PAGE_SIZE,
  MEMBER_STATUSES
} from '~~/shared/member-profile'
import type { MemberDirectorySort, MemberStatus } from '~~/shared/member-profile'

// The member directory: server-paginated, searchable, filterable table — the
// enterprise replacement for the flat members list. Self-contained (owns its own
// fetch + row actions); the page just drops it in. `currentUserId` is passed (not
// re-fetched) so a member can't act on themselves and the owner is protected.
const props = defineProps<{ currentUserId?: string }>()

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const pageSize = MEMBER_DIRECTORY_PAGE_SIZE
const STAFF_ROLES = ['owner', 'admin', 'coach'] as const

type Segment = 'all' | 'staff' | 'students'
const segment = ref<Segment>('all')
const searchInput = ref('')
const search = ref('')
const statuses = ref<MemberStatus[]>([])
const sort = ref<MemberDirectorySort>('name')
const order = ref<'asc' | 'desc'>('asc')
const page = ref(1)

// Debounce the search box so we don't refetch on every keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const roles = computed<readonly string[]>(() =>
  segment.value === 'staff' ? STAFF_ROLES : segment.value === 'students' ? ['student'] : []
)

// The filter slice (no pagination) — shared by the fetch query and the CSV export.
const filterQuery = computed(() => ({
  search: search.value || undefined,
  roles: roles.value.length ? [...roles.value] : undefined,
  statuses: statuses.value.length ? statuses.value : undefined,
  sort: sort.value,
  order: order.value
}))

const query = computed(() => ({ ...filterQuery.value, page: page.value, pageSize }))

// Any change to a filter (not the page) resets to page 1, so results never land
// the user on an out-of-range page.
watch([search, segment, statuses, sort, order], () => {
  page.value = 1
})

const { data, status, refresh } = useLazyFetch('/api/school/members/directory', {
  key: 'school:members-directory',
  query
})

const loading = computed(() => status.value === 'pending')
const rows = computed(() => data.value?.rows ?? [])
const total = computed(() => data.value?.total ?? 0)
const rangeFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize + 1))
const rangeTo = computed(() => Math.min(page.value * pageSize, total.value))

type DirectoryRow = NonNullable<typeof data.value>['rows'][number]

const filtersActive = computed(() =>
  search.value !== '' || statuses.value.length > 0 || segment.value !== 'all'
)

function clearFilters() {
  searchInput.value = ''
  search.value = ''
  statuses.value = []
  segment.value = 'all'
}

const segmentItems = computed(() => [
  { value: 'all' as const, label: t('school.members.directory.segments.all') },
  { value: 'staff' as const, label: t('school.members.directory.segments.staff') },
  { value: 'students' as const, label: t('school.members.directory.segments.students') }
])

const statusItems = computed(() =>
  MEMBER_STATUSES.map(value => ({ value, label: t(`school.members.directory.statusLabels.${value}`) }))
)

// Columns whose header is click-to-sort, mapped to the server sort key.
const SORTABLE = {
  member: 'name',
  role: 'role',
  status: 'status',
  joined: 'joined'
} as const satisfies Record<string, MemberDirectorySort>

const columns = computed<TableColumn<DirectoryRow>[]>(() => [
  { id: 'member', header: t('school.members.directory.columns.member') },
  { id: 'role', header: t('school.members.directory.columns.role') },
  { id: 'status', header: t('school.members.directory.columns.status') },
  { id: 'joined', header: t('school.members.directory.columns.joined') },
  { id: 'actions', header: '' }
])

function dateLabel(value: string) {
  return formatDate(value, locale.value)
}

const STATUS_COLOR: Record<MemberStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral'
}

// Click a header to sort by it; click again to flip direction (server-side).
function toggleSort(key: MemberDirectorySort) {
  if (sort.value === key) {
    order.value = order.value === 'asc' ? 'desc' : 'asc'
  } else {
    sort.value = key
    order.value = 'asc'
  }
}

function sortIcon(key: MemberDirectorySort) {
  if (sort.value !== key) {
    return 'i-lucide-chevrons-up-down'
  }
  return order.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
}

function canManage(row: DirectoryRow) {
  return row.role !== 'owner' && row.user.id !== props.currentUserId
}

async function changeRole(row: DirectoryRow, role: InvitableRole) {
  if (row.role === role) {
    return
  }
  try {
    await $fetch(`/api/school/members/${row.id}/role`, { method: 'PATCH', body: { role } })
    await refresh()
    toast.add({ title: t('school.members.roleUpdated', { name: row.user.name }), color: 'success' })
  } catch (error) {
    toastError('school.members.errors.updateFailed', error)
  }
}

function memberActions(row: DirectoryRow): DropdownMenuItem[][] {
  return [
    [{
      label: t('school.members.changeRole'),
      icon: 'i-lucide-user-cog',
      children: INVITABLE_ROLES.map(role => ({
        label: t(`roles.${role}`),
        type: 'checkbox' as const,
        checked: row.role === role,
        onSelect: () => { changeRole(row, role) }
      }))
    }],
    [{
      label: t('school.members.remove'),
      icon: 'i-lucide-user-minus',
      color: 'error' as const,
      onSelect: () => { memberToRemove.value = row }
    }]
  ]
}

const memberToRemove = ref<DirectoryRow | null>(null)
const removing = ref(false)

async function confirmRemove() {
  if (!memberToRemove.value) {
    return
  }
  const removed = memberToRemove.value
  removing.value = true
  try {
    await $fetch(`/api/school/members/${removed.id}` as string, { method: 'DELETE' })
    toast.add({ title: t('school.members.removed', { name: removed.user.name }), color: 'neutral' })
    memberToRemove.value = null
    await refresh()
  } catch (error) {
    toastError('school.members.errors.removeFailed', error)
  } finally {
    removing.value = false
  }
}

const exporting = ref(false)

async function exportCsv() {
  exporting.value = true
  try {
    const blob = await $fetch<Blob>('/api/school/members/export', {
      query: filterQuery.value,
      responseType: 'blob'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `members-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch {
    toast.add({ title: t('school.members.directory.exportFailed'), color: 'error' })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-2.5">
          <h2 class="font-semibold text-highlighted">
            {{ t('school.members.title') }}
          </h2>
          <UBadge
            v-if="!loading"
            :label="String(total)"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </div>
        <UButton
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-download"
          :label="t('school.members.directory.export')"
          :loading="exporting"
          :disabled="total === 0"
          @click="exportCsv"
        />
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <UFieldGroup size="sm">
          <UButton
            v-for="item in segmentItems"
            :key="item.value"
            :color="segment === item.value ? 'primary' : 'neutral'"
            :variant="segment === item.value ? 'solid' : 'subtle'"
            :label="item.label"
            @click="segment = item.value"
          />
        </UFieldGroup>

        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          size="sm"
          :placeholder="t('school.members.directory.searchPlaceholder')"
          :aria-label="t('school.members.directory.searchPlaceholder')"
          class="min-w-56 flex-1"
        />

        <USelectMenu
          v-model="statuses"
          multiple
          value-key="value"
          :items="statusItems"
          icon="i-lucide-circle-dot"
          :placeholder="t('school.members.directory.statusFilter')"
          variant="subtle"
          size="sm"
          class="min-w-36"
        />

        <UButton
          v-if="filtersActive"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          :label="t('common.clear')"
          @click="clearFilters"
        />
      </div>

      <UTable
        :data="rows"
        :columns="columns"
        :loading="loading"
        :ui="{ base: 'min-w-full', td: 'py-3', th: 'text-xs' }"
      >
        <template
          v-for="(key, id) in SORTABLE"
          :key="id"
          #[`${id}-header`]
        >
          <button
            type="button"
            class="inline-flex items-center gap-1 font-medium text-muted transition-colors hover:text-default"
            @click="toggleSort(key)"
          >
            {{ t(`school.members.directory.columns.${id}`) }}
            <UIcon
              :name="sortIcon(key)"
              class="size-3.5"
              :class="sort === key ? 'text-primary' : 'text-dimmed'"
            />
          </button>
        </template>

        <template #member-cell="{ row }">
          <div class="flex min-w-0 items-center gap-3">
            <UAvatar
              :src="row.original.user.image ?? undefined"
              :alt="row.original.user.name"
              size="md"
              class="shrink-0 ring-1 ring-default"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <ULink
                  :to="`/school/members/${row.original.id}`"
                  class="truncate text-sm font-medium text-highlighted hover:text-primary"
                >
                  {{ row.original.user.name }}
                </ULink>
                <UBadge
                  v-if="row.original.user.id === props.currentUserId"
                  :label="t('school.members.you')"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="truncate text-xs text-muted">
                {{ row.original.user.email }}
              </p>
            </div>
          </div>
        </template>

        <template #role-cell="{ row }">
          <RoleBadge :role="row.original.role" />
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :label="t(`school.members.directory.statusLabels.${row.original.status}`)"
            :color="STATUS_COLOR[row.original.status]"
            variant="subtle"
            size="sm"
          />
        </template>

        <template #joined-cell="{ row }">
          <span class="text-sm text-muted">{{ dateLabel(row.original.createdAt) }}</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UDropdownMenu
              v-if="canManage(row.original)"
              :items="memberActions(row.original)"
              :content="{ align: 'end' }"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis-vertical"
                size="sm"
                class="text-dimmed"
                :aria-label="t('school.members.actions')"
              />
            </UDropdownMenu>
          </div>
        </template>

        <template #empty>
          <div class="flex flex-col items-center py-10 text-center">
            <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-users"
                class="size-6 text-dimmed"
              />
            </div>
            <p class="mt-3 text-sm font-medium text-highlighted">
              {{ t('school.members.directory.empty.title') }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-muted">
              {{ t('school.members.directory.empty.description') }}
            </p>
          </div>
        </template>
      </UTable>

      <div
        v-if="total > 0"
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-sm text-muted">
          {{ t('school.members.directory.showing', { from: rangeFrom, to: rangeTo, total }) }}
        </p>
        <UPagination
          v-if="total > pageSize"
          v-model:page="page"
          :items-per-page="pageSize"
          :total="total"
          :sibling-count="1"
        />
      </div>
    </div>

    <UModal
      :open="memberToRemove !== null"
      :title="t('school.members.removeConfirm.title')"
      :description="t('school.members.removeConfirm.description', { name: memberToRemove?.user.name })"
      @update:open="(value: boolean) => { if (!value) memberToRemove = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="memberToRemove = null"
          />
          <UButton
            color="error"
            :loading="removing"
            :label="t('school.members.remove')"
            @click="confirmRemove"
          />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
