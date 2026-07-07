<script setup lang="ts">
// Placeholder rows shown while a member/invitation list is loading, mirroring
// the real row layout (avatar + two lines + trailing badge) to avoid layout
// shift when data arrives.
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <ul class="flex flex-col divide-y divide-default">
    <li
      v-for="i in rows"
      :key="i"
      class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
    >
      <div class="flex items-center gap-3">
        <USkeleton class="size-8 rounded-full" />
        <div class="flex flex-col gap-1.5">
          <USkeleton class="h-3.5 w-32" />
          <USkeleton class="h-3 w-48" />
        </div>
      </div>
      <USkeleton class="h-5 w-16 rounded-full" />
    </li>
  </ul>
</template>
