<script setup lang="ts">
const { t } = useI18n()
const year = new Date().getFullYear()
</script>

<template>
  <div class="min-h-screen grid lg:grid-cols-2">
    <aside class="hidden lg:flex flex-col justify-between gap-10 border-r border-default bg-muted p-10">
      <BrandMark horizontal />

      <div class="max-w-md">
        <h2 class="text-3xl font-semibold tracking-tight text-balance text-highlighted">
          {{ t('auth.aside.title') }}
        </h2>
        <p class="mt-3 text-muted">
          {{ t('auth.aside.subtitle') }}
        </p>
      </div>

      <p class="text-xs text-dimmed">
        © {{ year }} {{ t('brand.name') }}
      </p>
    </aside>

    <main class="relative flex flex-col items-center justify-center gap-10 px-6 py-16">
      <div class="absolute top-5 right-5 flex items-center gap-2">
        <LocaleSwitcher />
        <ColorModeButton />
      </div>

      <BrandMark class="lg:hidden" />
      <slot />
    </main>
  </div>
</template>
