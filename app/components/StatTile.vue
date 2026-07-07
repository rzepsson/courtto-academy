<script setup lang="ts">
defineProps<{
  label: string
  value: number | string
  icon: string
  loading?: boolean
}>()
</script>

<template>
  <Motion
    :while-hover="{ y: -3 }"
    :transition="{ type: 'spring', stiffness: 400, damping: 25 }"
    class="h-full"
  >
    <UCard
      variant="subtle"
      class="h-full transition-shadow duration-200 hover:shadow-md"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-muted">
            {{ label }}
          </p>
          <USkeleton
            v-if="loading"
            class="mt-2 h-8 w-12"
          />
          <p
            v-else
            class="mt-1 text-2xl font-semibold text-highlighted tabular-nums"
          >
            {{ value }}
          </p>
        </div>
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon
            :name="icon"
            class="size-5"
          />
        </div>
      </div>
    </UCard>
  </Motion>
</template>
