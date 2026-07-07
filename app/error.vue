<script setup lang="ts">
import type { NuxtError } from '#app'

// Rendered by Nuxt in place of the layout when a fatal error bubbles up (SSR or
// client). Self-contained: no access to layouts, so it re-creates the centered
// auth shell.
const props = defineProps<{ error: NuxtError }>()

const { t } = useI18n()
const year = new Date().getFullYear()

const isNotFound = computed(() => props.error.statusCode === 404)
const scope = computed(() => isNotFound.value ? 'notFound' : 'generic')

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <UApp>
    <div class="relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div class="absolute top-5 right-5 flex items-center gap-2">
        <LocaleSwitcher />
        <ColorModeButton />
      </div>

      <main class="flex w-full max-w-sm flex-col items-center text-center">
        <BrandMark />

        <div class="mt-10 flex flex-col items-center">
          <p class="text-6xl font-semibold tracking-tight text-primary">
            {{ error.statusCode }}
          </p>
          <h1 class="mt-4 text-xl font-semibold text-highlighted">
            {{ t(`error.${scope}.title`) }}
          </h1>
          <p class="mt-2 text-sm text-muted">
            {{ t(`error.${scope}.description`) }}
          </p>

          <PressButton
            class="mt-8"
            trailing-icon="i-lucide-arrow-right"
            :label="t('error.action')"
            @click="goHome"
          />
        </div>
      </main>

      <p class="absolute bottom-6 text-xs text-dimmed">
        © {{ year }} {{ t('brand.name') }}
      </p>
    </div>
  </UApp>
</template>
