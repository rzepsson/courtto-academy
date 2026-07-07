<script setup lang="ts">
// Never renders — `resolve-home` always redirects to the role's home area.
definePageMeta({ middleware: ['auth', 'resolve-home'] })
</script>

<template>
  <div />
</template>
