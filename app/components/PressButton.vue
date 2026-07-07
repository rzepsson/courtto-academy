<script setup lang="ts">
// The primary CTA press-spring used across auth, onboarding and invite flows.
// Wraps UButton so the spring constants and the icon-slide affordance live in
// one place. Reduced-motion is honored via the global MotionConfig in app.vue.
// Attrs fall through to the inner UButton (not the Motion root) and override the
// defaults below.
defineOptions({ inheritAttrs: false })
</script>

<template>
  <Motion
    :while-press="{ scale: 0.98 }"
    :transition="{ type: 'spring', stiffness: 500, damping: 30 }"
  >
    <UButton
      block
      size="lg"
      class="group"
      :ui="{ trailingIcon: 'transition-transform duration-200 group-hover:translate-x-0.5' }"
      v-bind="$attrs"
    >
      <slot />
    </UButton>
  </Motion>
</template>
