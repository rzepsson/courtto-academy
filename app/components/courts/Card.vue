<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CourtView } from '~/utils/courts'
import type { Sport } from '~~/shared/org-profile'

// Presentational roster tile: the court diagram as hero, with its metadata and
// (optionally) a management menu. Kept product-neutral apart from the menu, which
// the parent wires — so the marketplace could reuse it read-only (`:menu="false"`).
const props = withDefaults(defineProps<{
  court: CourtView
  menu?: boolean
}>(), { menu: false })

const emit = defineEmits<{ edit: [], archive: [], restore: [], delete: [] }>()

const { t } = useI18n()

const archived = computed(() => props.court.archivedAt !== null)
const unitLabel = computed(() => t(`courts.unit.${courtUnit(props.court.sport as Sport)}`))
const sportLabel = computed(() => t(`school.settings.sports.${props.court.sport}`))

// A concise metadata line: surface · environment · zone (only the parts present).
const metaParts = computed(() => {
  const parts: string[] = [sportLabel.value]
  if (props.court.surface) parts.push(t(`courts.surfaces.${props.court.surface}`))
  parts.push(t(`courts.environments.${props.court.environment}`))
  if (props.court.zone) parts.push(props.court.zone)
  return parts
})

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const primary: DropdownMenuItem[] = archived.value
    ? [{ label: t('courts.actions.restore'), icon: 'i-lucide-rotate-ccw', onSelect: () => emit('restore') }]
    : [
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
        <p class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">
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
        <CourtsStatusBadge
          v-if="!archived"
          :status="court.status"
        />
        <UBadge
          v-else
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
    </div>
  </div>
</template>
