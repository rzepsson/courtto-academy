<script setup lang="ts">
// Renders one legal document from its Markdown source. The page picks the source
// for the active locale and passes it in; this component owns only the rendering
// and the reading typography, so /terms and /privacy stay thin and identical.
const props = defineProps<{
  source: string
  version: string
  backTo?: string
}>()

const { t } = useI18n()

const html = computed(() => renderMarkdown(props.source))
</script>

<template>
  <MotionReveal :y="8">
    <div class="mb-6 flex items-center justify-between gap-4">
      <UBadge
        color="neutral"
        variant="subtle"
        :label="t('legal.version', { version })"
      />
      <UButton
        v-if="backTo"
        :to="backTo"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        :label="t('legal.back')"
      />
    </div>

    <!--
      The only v-html in the app, and it is the point: the document must render
      as the reviewed Markdown in docs/legal/ rather than a retyped copy. The
      source is a build-time `?raw` import from this repository — never user
      input, never fetched — and renderMarkdown() HTML-escapes every span it
      emits, so a stray angle bracket in a clause becomes text, not a tag.
    -->
    <!-- eslint-disable vue/no-v-html -->
    <article
      class="legal-body text-sm text-default"
      v-html="html"
    />
    <!-- eslint-enable vue/no-v-html -->
  </MotionReveal>
</template>

<style scoped>
/* Reading typography for the rendered Markdown. Scoped + :deep() because the
   content is injected as raw HTML, so utility classes cannot be attached to it. */
.legal-body :deep(h1) {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.3;
  margin-block: 2rem 1rem;
  color: var(--ui-text-highlighted);
}

.legal-body :deep(h1:first-child) {
  margin-top: 0;
}

.legal-body :deep(h2) {
  font-size: 1.125rem;
  font-weight: 600;
  margin-block: 2rem 0.75rem;
  color: var(--ui-text-highlighted);
}

.legal-body :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  margin-block: 1.5rem 0.5rem;
  color: var(--ui-text-highlighted);
}

.legal-body :deep(p) {
  margin-block: 0.75rem;
  line-height: 1.7;
}

.legal-body :deep(ul),
.legal-body :deep(ol) {
  margin-block: 0.75rem;
  padding-inline-start: 1.5rem;
  line-height: 1.7;
}

.legal-body :deep(ul) {
  list-style: disc;
}

.legal-body :deep(ol) {
  list-style: decimal;
}

.legal-body :deep(li) {
  margin-block: 0.35rem;
  padding-inline-start: 0.25rem;
}

.legal-body :deep(strong) {
  font-weight: 600;
  color: var(--ui-text-highlighted);
}

.legal-body :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.legal-body :deep(code) {
  font-size: 0.85em;
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background-color: var(--ui-bg-elevated);
}

.legal-body :deep(hr) {
  margin-block: 2rem;
  border-color: var(--ui-border);
}

.legal-body :deep(blockquote) {
  margin-block: 1rem;
  padding: 0.75rem 1rem;
  border-inline-start: 3px solid var(--ui-border-accented);
  border-radius: 0 0.375rem 0.375rem 0;
  background-color: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
}

.legal-body :deep(blockquote p:first-child) {
  margin-top: 0;
}

.legal-body :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

/* Tables carry the retention and sub-processor sections, so they must stay
   readable on a phone — the wrapper scrolls rather than the page body. */
.legal-body :deep(.md-table-wrap) {
  overflow-x: auto;
  margin-block: 1rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
}

.legal-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.legal-body :deep(th),
.legal-body :deep(td) {
  padding: 0.5rem 0.75rem;
  text-align: start;
  vertical-align: top;
  border-bottom: 1px solid var(--ui-border);
}

.legal-body :deep(th) {
  font-weight: 600;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
  background-color: var(--ui-bg-elevated);
}

.legal-body :deep(tbody tr:last-child td) {
  border-bottom: none;
}

.legal-body :deep(.md-check) {
  font-size: 1.1em;
}
</style>
