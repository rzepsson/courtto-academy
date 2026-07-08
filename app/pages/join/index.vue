<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { t } = useI18n()

const state = reactive({ code: '' })
const error = ref(false)
const canContinue = computed(() => state.code.trim().length > 0)

// Resolve through the shared smart parser so a pasted link still works here
// (routes to /join/<code> or /invite/<id>) instead of 404-ing.
function onSubmit() {
  const target = resolveJoinTarget(state.code)

  if (!target) {
    error.value = true
    return
  }

  error.value = false
  navigateTo(target)
}
</script>

<template>
  <div class="w-full">
    <MotionReveal
      :y="8"
      class="flex flex-col items-center text-center"
    >
      <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
        <UIcon
          name="i-lucide-ticket"
          class="size-7 text-primary"
        />
      </div>
      <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
        {{ t('join.promptTitle') }}
      </h1>
      <p class="mt-2 text-sm text-muted">
        {{ t('join.subtitle') }}
      </p>
    </MotionReveal>

    <MotionReveal
      :y="8"
      :delay="0.08"
      class="mt-8"
    >
      <UForm
        :state="state"
        class="flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField
          :label="t('join.codeLabel')"
          name="code"
          :error="error ? t('join.inputInvalid') : undefined"
        >
          <UInput
            v-model="state.code"
            size="lg"
            autofocus
            autocapitalize="characters"
            :placeholder="t('join.codePlaceholder')"
            class="w-full"
            :ui="{ base: 'text-center font-mono uppercase tracking-[0.25em]' }"
            @update:model-value="error = false"
          />
        </UFormField>

        <PressButton
          type="submit"
          trailing-icon="i-lucide-arrow-right"
          :disabled="!canContinue"
          :label="t('join.continue')"
        />
      </UForm>
    </MotionReveal>
  </div>
</template>
