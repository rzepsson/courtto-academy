<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { t } = useI18n()

const state = reactive({ code: '' })
// Route param resolution normalizes anyway; strip here only so the URL we push
// is clean ("ABCD-EFGH" typed → /join/ABCDEFGH).
const normalized = computed(() => state.code.toUpperCase().replace(/[^A-Z0-9]/g, ''))
const canContinue = computed(() => normalized.value.length > 0)

function onSubmit() {
  if (canContinue.value) {
    navigateTo(`/join/${normalized.value}`)
  }
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
        >
          <UInput
            v-model="state.code"
            size="lg"
            autofocus
            autocapitalize="characters"
            :placeholder="t('join.codePlaceholder')"
            class="w-full"
            :ui="{ base: 'text-center font-mono uppercase tracking-[0.25em]' }"
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
