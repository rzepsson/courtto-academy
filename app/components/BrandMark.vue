<script setup lang="ts">
defineProps<{ horizontal?: boolean }>()
</script>

<template>
  <div
    v-if="horizontal"
    class="flex select-none items-center gap-3"
  >
    <AppLogo class="size-9 shrink-0" />
    <div class="leading-tight">
      <p class="text-base font-bold tracking-tight text-highlighted">
        Courtto
      </p>
      <p class="text-[10px] font-medium uppercase tracking-[0.28em] text-primary">
        Academy
      </p>
    </div>
  </div>
  <div
    v-else
    class="flex select-none flex-col items-center gap-4"
  >
    <AppLogo class="size-16" />
    <div class="text-center">
      <p class="text-3xl font-bold tracking-tight text-highlighted">
        Courtto
      </p>
      <p class="text-sm font-medium uppercase tracking-[0.35em] text-primary">
        Academy
      </p>
    </div>
  </div>
</template>
