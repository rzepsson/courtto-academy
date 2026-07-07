<script setup lang="ts">
defineProps<{
  label: string
  value: number | string
  icon: string
}>()
</script>

<template>
  <UCard variant="subtle">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-sm text-muted">
          {{ label }}
        </p>
        <p class="mt-1 text-2xl font-semibold text-highlighted">
          {{ value }}
        </p>
      </div>
      <UIcon
        :name="icon"
        class="size-5 shrink-0 text-dimmed"
      />
    </div>
  </UCard>
</template>
