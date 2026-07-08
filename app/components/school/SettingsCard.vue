<script setup lang="ts">
import type { FormError } from '@nuxt/ui'

// One settings section in the enterprise two-column layout: the section
// title/description sit in a narrow left column, the form (or free content) in a
// wider card on the right. The `id` anchors the section for the sticky side-nav.
// When `form` is true (default) the slot is wrapped in a UForm with a
// right-aligned, press-animated Save button that's disabled until dirty.
withDefaults(defineProps<{
  id: string
  title: string
  subtitle?: string
  tone?: 'default' | 'danger'
  form?: boolean
  state?: Record<string, unknown>
  validate?: (state: unknown) => FormError[] | Promise<FormError[]>
  dirty?: boolean
  saving?: boolean
  saveLabel?: string
}>(), {
  tone: 'default',
  form: true,
  dirty: true
})

const emit = defineEmits<{ submit: [] }>()
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
          :validate="validate"
          class="flex flex-col gap-5"
          @submit="emit('submit')"
        >
          <slot />

          <div class="flex justify-end pt-1">
            <Motion
              :while-press="{ scale: 0.97 }"
              :transition="{ type: 'spring', stiffness: 500, damping: 30 }"
            >
              <UButton
                type="submit"
                size="lg"
                :loading="saving"
                :disabled="!dirty"
                :label="saveLabel ?? t('common.save')"
              />
            </Motion>
          </div>
        </UForm>

        <slot v-else />
      </UCard>
    </div>
  </section>
</template>
