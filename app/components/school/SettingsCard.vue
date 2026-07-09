<script setup lang="ts">
import type { FormError, FormSchema } from '@nuxt/ui'

// One settings section in the enterprise two-column layout: the section
// title/description sit in a narrow left column, the form (or free content) in a
// wider card on the right. The `id` anchors the section for the sticky side-nav.
// When `form` is true (default) the slot is wrapped in a UForm whose action row
// (Discard + Save) only slides into existence while the section is dirty, so a
// pristine page shows no button noise at all.
//
// Validation is either a `schema` (a Standard Schema — the profile sections bind
// their slice of the shared Zod schema) or a `validate` function (the general
// section, whose name/slug rules aren't part of that schema). Pass at most one.
withDefaults(defineProps<{
  id: string
  title: string
  subtitle?: string
  tone?: 'default' | 'danger'
  form?: boolean
  state?: Record<string, unknown>
  schema?: FormSchema
  validate?: (state: unknown) => FormError[] | Promise<FormError[]>
  dirty?: boolean
  saving?: boolean
  saveLabel?: string
}>(), {
  tone: 'default',
  form: true,
  dirty: false
})

const emit = defineEmits<{ submit: [], discard: [] }>()
const { t } = useI18n()
</script>

<template>
  <section
    :id="id"
    class="grid scroll-mt-6 gap-x-10 gap-y-4 lg:grid-cols-3"
  >
    <div class="lg:col-span-1">
      <h2
        class="font-semibold"
        :class="tone === 'danger' ? 'text-error' : 'text-highlighted'"
      >
        {{ title }}
      </h2>
      <p
        v-if="subtitle"
        class="mt-1.5 text-sm text-muted lg:pr-8"
      >
        {{ subtitle }}
      </p>
    </div>

    <div class="lg:col-span-2">
      <UCard
        variant="subtle"
        class="transition-shadow duration-200 hover:shadow-md"
        :class="tone === 'danger' ? 'ring-error/25' : undefined"
      >
        <UForm
          v-if="form"
          :state="state ?? {}"
          :schema="schema"
          :validate="validate"
          class="flex flex-col gap-5"
          @submit="emit('submit')"
        >
          <slot />

          <AnimatePresence>
            <Motion
              v-if="dirty"
              :initial="{ opacity: 0, height: 0 }"
              :animate="{ opacity: 1, height: 'auto' }"
              :exit="{ opacity: 0, height: 0 }"
              :transition="{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }"
              class="overflow-hidden"
            >
              <div class="flex justify-end gap-2 pt-1">
                <UButton
                  type="button"
                  size="lg"
                  color="neutral"
                  variant="ghost"
                  :disabled="saving"
                  :label="t('common.discard')"
                  @click="emit('discard')"
                />
                <Motion
                  :while-press="{ scale: 0.97 }"
                  :transition="{ type: 'spring', stiffness: 500, damping: 30 }"
                >
                  <UButton
                    type="submit"
                    size="lg"
                    :loading="saving"
                    :label="saveLabel ?? t('common.save')"
                  />
                </Motion>
              </div>
            </Motion>
          </AnimatePresence>
        </UForm>

        <slot v-else />
      </UCard>
    </div>
  </section>
</template>
