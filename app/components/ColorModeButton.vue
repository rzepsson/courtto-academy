<script setup lang="ts">
const { t } = useI18n()
const colorMode = useColorMode()

const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (value) => {
    colorMode.preference = value ? 'dark' : 'light'
  }
})

function toggleTheme(event: MouseEvent) {
  const next = !isDark.value
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!document.startViewTransition || reducedMotion) {
    isDark.value = next
    return
  }

  const { clientX: x, clientY: y } = event
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  const transition = document.startViewTransition(() => {
    isDark.value = next
  })

  transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
    )
  })
}
</script>

<template>
  <ClientOnly>
    <UButton
      :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
      color="neutral"
      variant="ghost"
      :aria-label="t('common.toggleTheme')"
      @click="toggleTheme"
    />
    <template #fallback>
      <div class="size-8" />
    </template>
  </ClientOnly>
</template>
