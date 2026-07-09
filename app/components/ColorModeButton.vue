<script setup lang="ts">
const { t } = useI18n()
const colorMode = useColorMode()

const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (value) => {
    colorMode.preference = value ? 'dark' : 'light'
  }
})

function toggleTheme() {
  const next = !isDark.value
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!document.startViewTransition || reducedMotion) {
    isDark.value = next
    return
  }

  document.startViewTransition(() => {
    isDark.value = next
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
