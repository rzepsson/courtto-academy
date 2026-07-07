<script setup lang="ts">
const { t } = useI18n()
const year = new Date().getFullYear()
</script>

<template>
  <div class="relative flex min-h-screen flex-col items-center px-6 pb-16 pt-[max(4rem,14vh)]">
    <div class="absolute top-5 right-5 flex items-center gap-2">
      <LocaleSwitcher />
      <ColorModeButton />
    </div>

    <main class="flex w-full max-w-sm flex-col items-center">
      <BrandMark />

      <MotionConfig reduced-motion="user">
        <div class="mt-10 w-full">
          <slot />
        </div>
      </MotionConfig>
    </main>

    <p class="absolute bottom-6 text-xs text-dimmed">
      © {{ year }} {{ t('brand.name') }}
    </p>
  </div>
</template>
