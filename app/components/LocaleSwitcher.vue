<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t, locale, locales, setLocale } = useI18n()

const items = computed<DropdownMenuItem[]>(() =>
  locales.value.map(l => ({
    label: l.name,
    type: 'checkbox',
    checked: locale.value === l.code,
    onUpdateChecked: () => setLocale(l.code)
  }))
)
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
  >
    <UButton
      icon="i-lucide-globe"
      color="neutral"
      variant="ghost"
      :aria-label="t('common.language')"
    />
  </UDropdownMenu>
</template>
