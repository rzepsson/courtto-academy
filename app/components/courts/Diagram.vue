<script setup lang="ts">
import type { Sport } from '~~/shared/org-profile'

// Pure, product-neutral SVG renderer for a court/table. Lives in components/courts
// (not school/) on purpose: the future Courtto marketplace reuses it. Given a
// discipline it draws the correct white-line pattern (COURT_SPECS) filled with
// the chosen surface colour — the line pattern is derived from `sport`, never
// stored. No data fetching, no domain logic; safe to render anywhere.

const props = withDefaults(defineProps<{
  sport: string
  surfaceColor?: string
  lineColor?: string
  orientation?: 'portrait' | 'landscape'
}>(), {
  surfaceColor: undefined,
  lineColor: undefined,
  orientation: 'landscape'
})

const valid = computed(() => isCourtSport(props.sport))
const fill = computed(() =>
  props.surfaceColor || (valid.value ? DEFAULT_SURFACE_COLOR[props.sport as Sport] : '#2f6db5'))
const stroke = computed(() => props.lineColor || DEFAULT_LINE_COLOR)

const geo = computed(() => {
  if (!valid.value) {
    return null
  }
  const spec = courtSpec(props.sport as Sport)
  const { width: w, length: l } = spec
  const maxDim = Math.max(w, l)
  const margin = maxDim * 0.06
  const sw = maxDim * 0.007
  const wall = 0.35
  const landscape = props.orientation === 'landscape'

  return {
    w,
    l,
    sw,
    wall,
    net: spec.hasNet ? l / 2 : null,
    enclosed: spec.enclosed,
    lines: spec.lines,
    vbW: landscape ? l + 2 * margin : w + 2 * margin,
    vbH: landscape ? w + 2 * margin : l + 2 * margin,
    // Draw everything in portrait playing-area coords (0,0)–(w,l); this transform
    // places the margin and, in landscape, rotates the whole court 90°.
    inner: landscape
      ? `translate(${margin}, ${w + margin}) rotate(-90)`
      : `translate(${margin}, ${margin})`,
    radius: margin * 0.5
  }
})
</script>

<template>
  <svg
    v-if="geo"
    :viewBox="`0 0 ${geo.vbW} ${geo.vbH}`"
    preserveAspectRatio="xMidYMid meet"
    class="size-full"
    role="img"
  >
    <!-- Run-off surround: the surface colour, darkened so the court reads brighter. -->
    <rect
      :width="geo.vbW"
      :height="geo.vbH"
      :rx="geo.radius"
      :fill="fill"
    />
    <rect
      :width="geo.vbW"
      :height="geo.vbH"
      :rx="geo.radius"
      fill="#000000"
      opacity="0.18"
    />

    <g :transform="geo.inner">
      <!-- Playing surface -->
      <rect
        :width="geo.w"
        :height="geo.l"
        :fill="fill"
      />

      <!-- Enclosing walls (padel / squash / racquetball) -->
      <rect
        v-if="geo.enclosed"
        :x="-geo.wall"
        :y="-geo.wall"
        :width="geo.w + 2 * geo.wall"
        :height="geo.l + 2 * geo.wall"
        :rx="geo.wall"
        fill="none"
        :stroke="stroke"
        :stroke-width="geo.sw * 1.2"
        opacity="0.4"
      />

      <!-- Boundary -->
      <rect
        :width="geo.w"
        :height="geo.l"
        fill="none"
        :stroke="stroke"
        :stroke-width="geo.sw"
      />

      <!-- Interior markings (service lines, boxes, kitchen, centre line…) -->
      <line
        v-for="(seg, i) in geo.lines"
        :key="i"
        :x1="seg.x1"
        :y1="seg.y1"
        :x2="seg.x2"
        :y2="seg.y2"
        :stroke="stroke"
        :stroke-width="geo.sw"
        stroke-linecap="square"
      />

      <!-- Net -->
      <line
        v-if="geo.net !== null"
        :x1="0"
        :y1="geo.net"
        :x2="geo.w"
        :y2="geo.net"
        stroke="#0f172a"
        :stroke-width="geo.sw * 1.5"
        opacity="0.55"
      />
    </g>
  </svg>

  <!-- Fallback for an unknown sport: a neutral tile so the layout never breaks. -->
  <div
    v-else
    class="flex size-full items-center justify-center rounded-md bg-elevated"
  >
    <UIcon
      name="i-lucide-land-plot"
      class="size-6 text-dimmed"
    />
  </div>
</template>
