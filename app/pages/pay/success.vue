<script setup lang="ts">
// Public landing after a parent completes Stripe Checkout — no login (they have no
// account). The subscription is confirmed by the webhook, not here; this is just a
// friendly acknowledgement.
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
</script>

<template>
  <div class="flex w-full flex-col items-center text-center">
    <div class="flex size-14 items-center justify-center rounded-full bg-primary/10">
      <UIcon
        name="i-lucide-circle-check"
        class="size-7 text-primary"
      />
    </div>
    <h1 class="mt-5 text-lg font-semibold text-highlighted">
      {{ t('pay.success.title') }}
    </h1>
    <p class="mt-2 max-w-sm text-sm text-muted">
      {{ t('pay.success.description') }}
    </p>
  </div>
</template>
