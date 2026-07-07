<script setup lang="ts">
// Consistent entrance animation for client-area (dashboard) content: a short
// fade + rise on mount. Use `delay` to stagger siblings. Honors reduced-motion
// via the global <MotionConfig reduced-motion="user"> in app.vue. Renders a
// <div> wrapper (Motion's default element).
withDefaults(defineProps<{
  delay?: number
  y?: number
}>(), {
  delay: 0,
  y: 12
})
</script>

<template>
  <Motion
    :initial="{ opacity: 0, y }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }"
  >
    <slot />
  </Motion>
</template>
