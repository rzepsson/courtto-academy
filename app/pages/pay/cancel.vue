<script setup lang="ts">
// Public landing when a parent abandons Stripe Checkout — no login. Nothing was
// charged; they can use the link again from their email.
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
</script>

<template>
  <div class="flex w-full flex-col items-center text-center">
    <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
      <UIcon
        name="i-lucide-x"
        class="size-7 text-dimmed"
      />
    </div>
    <h1 class="mt-5 text-lg font-semibold text-highlighted">
      {{ t('pay.cancel.title') }}
    </h1>
    <p class="mt-2 max-w-sm text-sm text-muted">
      {{ t('pay.cancel.description') }}
    </p>
  </div>
</template>
