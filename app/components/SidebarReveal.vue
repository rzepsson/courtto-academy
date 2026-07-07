<script setup lang="ts">
// Animates a sidebar label in/out of existence when the sidebar collapses,
// tweening the real (auto-measured) width alongside opacity so the reveal
// tracks the sidebar's own width transition instead of snapping instantly.
defineProps<{ collapsed?: boolean }>()
</script>

<template>
  <AnimatePresence>
    <Motion
      v-if="!collapsed"
      :initial="{ opacity: 0, width: 0 }"
      :animate="{ opacity: 1, width: 'auto' }"
      :exit="{ opacity: 0, width: 0 }"
      :transition="{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }"
      class="overflow-hidden whitespace-nowrap"
    >
      <slot />
    </Motion>
  </AnimatePresence>
</template>
