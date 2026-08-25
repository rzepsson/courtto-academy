<script setup lang="ts">
import plSource from '~~/docs/legal/pl/polityka-prywatnosci.md?raw'
import enSource from '~~/docs/legal/en/privacy-policy.md?raw'
import { LEGAL_DOCUMENT_VERSIONS } from '~~/shared/legal'

definePageMeta({ layout: 'legal' })

const { locale, t } = useI18n()

const source = computed(() => (locale.value === 'pl' ? plSource : enSource))

useHead({ title: t('legal.privacy.title') })
</script>

<template>
  <LegalDocument
    :source="source"
    :version="LEGAL_DOCUMENT_VERSIONS.privacy"
    back-to="/register"
  />
</template>
