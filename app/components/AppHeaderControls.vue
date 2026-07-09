<script setup lang="ts">
// The standard cluster of dashboard navbar actions (notifications, language,
// theme). Bundled so every area page's `#right` slot stays a single tag and the
// controls can't drift apart between pages.
</script>

<template>
  <div class="flex items-center gap-1">
    <NotificationBell />
    <LocaleSwitcher />
    <ColorModeButton />
  </div>
</template>
