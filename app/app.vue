<script setup lang="ts">
const { t } = useI18n()

useHead({
  link: [{ rel: 'icon', href: '/favicon.ico' }]
})

useSeoMeta({
  title: () => t('brand.name'),
  description: () => t('home.tagline')
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
