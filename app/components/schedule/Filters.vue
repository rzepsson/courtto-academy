<script setup lang="ts">
import type { CourtView, CourtZoneView } from '~/utils/courts'

// The calendar filter bar. Each picker is an "empty = all" multi-select; the
// status control is a single-select. Purely client-side: the page applies the
// bound state to the already-fetched sessions via `sessionMatchesFilters`, so
// filtering is instant and needs no refetch. Controls with a single option (e.g.
// one offered sport) are hidden to keep the bar uncluttered.
const props = defineProps<{
  coaches: { id: string, name: string }[]
  courts: CourtView[]
  zones: CourtZoneView[]
  sports: string[]
}>()

const coachMemberIds = defineModel<string[]>('coachMemberIds', { default: () => [] })
const courtIds = defineModel<string[]>('courtIds', { default: () => [] })
const zoneIds = defineModel<string[]>('zoneIds', { default: () => [] })
const selectedSports = defineModel<string[]>('selectedSports', { default: () => [] })
const types = defineModel<string[]>('types', { default: () => [] })
const status = defineModel<'all' | 'active' | 'cancelled'>('status', { default: 'all' })

const { t } = useI18n()

const coachItems = computed(() => [
  { value: NO_COACH_VALUE, label: t('schedule.form.noCoach') },
  ...props.coaches.map(c => ({ value: c.id, label: c.name }))
])
const courtItems = computed(() => props.courts.map(c => ({ value: c.id, label: c.name })))
const zoneItems = computed(() => props.zones.map(z => ({ value: z.id, label: z.name })))
const sportItems = computed(() =>
  props.sports.filter(isCourtSport).map(s => ({ value: s as string, label: t(`school.settings.sports.${s}`) }))
)
const typeItems = computed(() => lessonTypeOptions(t))
const statusItems = computed(() => [
  { value: 'all', label: t('schedule.filters.status.all') },
  { value: 'active', label: t('schedule.filters.status.active') },
  { value: 'cancelled', label: t('schedule.filters.status.cancelled') }
])

const active = computed(() => isScheduleFilterActive({
  coachMemberIds: coachMemberIds.value,
  courtIds: courtIds.value,
  zoneIds: zoneIds.value,
  sports: selectedSports.value,
  types: types.value,
  status: status.value
}))

function clear() {
  coachMemberIds.value = []
  courtIds.value = []
  zoneIds.value = []
  selectedSports.value = []
  types.value = []
  status.value = 'all'
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UIcon
      name="i-lucide-list-filter"
      class="size-4 shrink-0 text-dimmed"
    />

    <USelectMenu
      v-if="coaches.length"
      v-model="coachMemberIds"
      multiple
      value-key="value"
      :items="coachItems"
      icon="i-lucide-user-round"
      :placeholder="t('schedule.filters.allCoaches')"
      :search-input="{ placeholder: t('common.search') }"
      variant="subtle"
      size="sm"
      class="min-w-40"
    />

    <USelectMenu
      v-if="courtItems.length"
      v-model="courtIds"
      multiple
      value-key="value"
      :items="courtItems"
      icon="i-lucide-land-plot"
      :placeholder="t('schedule.filters.allCourts')"
      :search-input="{ placeholder: t('common.search') }"
      variant="subtle"
      size="sm"
      class="min-w-40"
    />

    <USelectMenu
      v-if="zoneItems.length"
      v-model="zoneIds"
      multiple
      value-key="value"
      :items="zoneItems"
      icon="i-lucide-layout-grid"
      :placeholder="t('schedule.filters.allZones')"
      :search-input="{ placeholder: t('common.search') }"
      variant="subtle"
      size="sm"
      class="min-w-36"
    />

    <USelectMenu
      v-if="sportItems.length > 1"
      v-model="selectedSports"
      multiple
      value-key="value"
      :items="sportItems"
      icon="i-lucide-activity"
      :placeholder="t('schedule.filters.allSports')"
      variant="subtle"
      size="sm"
      class="min-w-36"
    />

    <USelectMenu
      v-model="types"
      multiple
      value-key="value"
      :items="typeItems"
      icon="i-lucide-shapes"
      :placeholder="t('schedule.filters.allTypes')"
      variant="subtle"
      size="sm"
      class="min-w-36"
    />

    <USelect
      v-model="status"
      value-key="value"
      :items="statusItems"
      icon="i-lucide-circle-dot"
      variant="subtle"
      size="sm"
      class="min-w-36"
    />

    <UButton
      v-if="active"
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-x"
      :label="t('schedule.filters.clear')"
      @click="clear"
    />
  </div>
</template>
