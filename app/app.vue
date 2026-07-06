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
    <MotionConfig :reduced-motion="'user'">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </MotionConfig>
  </UApp>
</template>
