<script setup lang="ts">
// The Markdown in docs/legal/ is the reviewed, versioned source of truth; it is
// imported raw and rendered here so the page can never drift from the document a
// user actually accepted.
import plSource from '~~/docs/legal/pl/regulamin.md?raw'
import enSource from '~~/docs/legal/en/terms-of-service.md?raw'
import { LEGAL_DOCUMENT_VERSIONS } from '~~/shared/legal'

definePageMeta({ layout: 'legal' })

const { locale, t } = useI18n()

const source = computed(() => (locale.value === 'pl' ? plSource : enSource))

useHead({ title: t('legal.terms.title') })
</script>

<template>
  <LegalDocument
    :source="source"
    :version="LEGAL_DOCUMENT_VERSIONS.terms"
    back-to="/register"
  />
</template>
