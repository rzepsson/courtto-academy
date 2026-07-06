<script setup lang="ts">
const { locale, locales, setLocale } = useI18n()
</script>

<template>
  <UFieldGroup size="sm">
    <UButton
      v-for="l in locales"
      :key="l.code"
      :label="l.name"
      :color="locale === l.code ? 'primary' : 'neutral'"
      :variant="locale === l.code ? 'solid' : 'outline'"
      @click="setLocale(l.code)"
    />
  </UFieldGroup>
</template>
