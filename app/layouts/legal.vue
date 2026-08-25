<script setup lang="ts">
const { t } = useI18n()
const year = new Date().getFullYear()
</script>

<template>
  <div class="relative flex min-h-screen flex-col items-center px-6 pb-16 pt-[max(3rem,8vh)]">
    <div class="absolute top-5 right-5 flex items-center gap-2">
      <LocaleSwitcher />
      <ColorModeButton />
    </div>

    <main class="flex w-full max-w-3xl flex-col">
      <BrandMark class="self-center" />

      <div class="mt-10 w-full">
        <slot />
      </div>
    </main>

    <p class="mt-16 text-xs text-dimmed">
      © {{ year }} {{ t('brand.name') }}
    </p>
  </div>
</template>
