<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CourtView } from '~/utils/courts'

// Presentational roster tile: the court diagram as hero, with its metadata and
// (optionally) a management menu. Kept product-neutral apart from the menu, which
// the parent wires — so the marketplace could reuse it read-only (`:menu="false"`).
// `scheduleAction`/`blockAction` are opt-in, off-by-default admin affordances
// (a "view in schedule" and a "block for maintenance" menu entry). Gating them
// keeps the tile product-neutral: the marketplace reuses the card without ever
// surfacing scheduling/maintenance-management concepts.
const props = withDefaults(defineProps<{
  court: CourtView
  menu?: boolean
  scheduleAction?: boolean
  blockAction?: boolean
  // When set, the title becomes a link to this route (the detail page). A plain
  // route string, so the card stays product-neutral — the parent owns the target.
  to?: string
}>(), { menu: false, scheduleAction: false, blockAction: false })

const emit = defineEmits<{ edit: [], archive: [], restore: [], delete: [], schedule: [], block: [] }>()

const { t } = useI18n()

const archived = computed(() => props.court.archivedAt !== null)
const unitLabel = computed(() => courtUnitLabel(props.court.sport, t))
const metaParts = computed(() => courtMetaParts(props.court, t))

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const primary: DropdownMenuItem[] = archived.value
    ? [{ label: t('courts.actions.restore'), icon: 'i-lucide-rotate-ccw', onSelect: () => emit('restore') }]
    : [
        ...(props.scheduleAction
          ? [{ label: t('courts.actions.viewSchedule'), icon: 'i-lucide-calendar-days', onSelect: () => emit('schedule') }]
          : []),
        ...(props.blockAction
          ? [{ label: t('courts.actions.block'), icon: 'i-lucide-wrench', onSelect: () => emit('block') }]
          : []),
        { label: t('courts.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => emit('edit') },
        { label: t('courts.actions.archive'), icon: 'i-lucide-archive', onSelect: () => emit('archive') }
      ]
  // Permanent delete is always its own group — visually separated from the
  // reversible actions and error-toned, so it's hard to hit by accident.
  return [primary, [{
    label: t('courts.actions.delete'),
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => emit('delete')
  }]]
})
</script>

<template>
  <div
    class="group relative flex flex-col overflow-hidden rounded-xl bg-default ring-1 ring-default transition-shadow hover:shadow-md"
    :class="archived && 'opacity-60 grayscale-35'"
  >
    <!-- Diagram hero (kept clean — no overlays covering the court) -->
    <div class="aspect-16/10 w-full overflow-hidden bg-elevated">
      <CourtsDiagram
        :sport="court.sport"
        :surface-color="court.surfaceColor"
        :line-color="court.lineColor"
      />
    </div>

    <!-- Metadata -->
    <div class="flex min-w-0 flex-col gap-2 p-3.5">
      <div class="flex items-center gap-2">
        <NuxtLink
          v-if="to"
          :to="to"
          class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted transition-colors hover:text-primary"
        >
          {{ court.name }}
        </NuxtLink>
        <p
          v-else
          class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted"
        >
          {{ court.name }}
        </p>
        <UDropdownMenu
          v-if="menu"
          :items="menuItems"
          :content="{ align: 'end' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            square
            icon="i-lucide-ellipsis"
            class="-me-1 shrink-0 text-dimmed transition-colors hover:text-default"
            :aria-label="t('courts.actions.menu')"
          />
        </UDropdownMenu>
      </div>

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
        <span class="min-w-0 truncate text-xs text-muted">
          {{ metaParts.join(' · ') }}
        </span>
      </div>

      <UButton
        v-if="to"
        :to="to"
        color="neutral"
        variant="subtle"
        size="xs"
        trailing-icon="i-lucide-arrow-right"
        :label="t('courts.details')"
        class="mt-1 self-start"
      />
    </div>
  </div>
</template>
