<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'guest', layout: 'auth' })

const { t } = useI18n()
const { toastError } = useApiError()

interface ForgotForm {
  email: string
}

const state = reactive<ForgotForm>({ email: '' })
const loading = ref(false)
const sent = ref(false)
const sentTo = ref('')

function validate(form: ForgotForm): FormError[] {
  const errors: FormError[] = []
  if (!form.email) errors.push({ name: 'email', message: t('auth.errors.emailRequired') })
  return errors
}

async function onSubmit(event: FormSubmitEvent<ForgotForm>) {
  loading.value = true
  const email = event.data.email.trim()
  // Better Auth returns an identical success response whether or not the account
  // exists (enumeration-safe), so we always show the same confirmation. `redirectTo`
  // is where its tokenized callback lands the user — our reset page.
  const { error } = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
  loading.value = false

  if (error) {
    toastError('auth.errors.resetRequestFailed', error)
    return
  }

  sentTo.value = email
  sent.value = true
}

function resend() {
  sent.value = false
}
</script>

<template>
  <div class="w-full">
    <template v-if="!sent">
      <MotionReveal :y="8">
        <div class="text-center">
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
            {{ t('auth.forgot.title') }}
          </h1>
          <p class="mt-2 text-sm text-muted">
            {{ t('auth.forgot.subtitle') }}
          </p>
        </div>
      </MotionReveal>

      <MotionReveal
        :y="8"
        :delay="0.08"
      >
        <UForm
          :state="state"
          :validate="validate"
          class="mt-8 flex flex-col gap-5"
          @submit="onSubmit"
        >
          <UFormField
            :label="t('auth.fields.email')"
            name="email"
          >
            <UInput
              v-model="state.email"
              type="email"
              size="lg"
              autocomplete="email"
              :placeholder="t('auth.fields.emailPlaceholder')"
              class="w-full"
            />
          </UFormField>

          <PressButton
            type="submit"
            class="mt-1"
            trailing-icon="i-lucide-arrow-right"
            :loading="loading"
            :label="t('auth.forgot.submit')"
          />
        </UForm>
      </MotionReveal>

      <MotionReveal
        :y="8"
        :delay="0.16"
      >
        <USeparator class="my-8" />

        <p class="text-center text-sm text-muted">
          <ULink
            to="/login"
            class="font-medium text-primary"
          >
            {{ t('auth.forgot.backToLogin') }}
          </ULink>
        </p>
      </MotionReveal>
    </template>

    <template v-else>
      <MotionReveal :y="8">
        <div class="flex flex-col items-center text-center">
          <div class="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <UIcon
              name="i-lucide-mail-check"
              class="size-7 text-primary"
            />
          </div>
          <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
            {{ t('auth.forgot.sentTitle') }}
          </h1>
          <p class="mt-2 text-sm text-muted">
            {{ t('auth.forgot.sentSubtitle', { email: sentTo }) }}
          </p>
          <p class="mt-4 text-xs text-dimmed">
            {{ t('auth.forgot.sentHint') }}
          </p>
        </div>
      </MotionReveal>

      <MotionReveal
        :y="8"
        :delay="0.08"
      >
        <div class="mt-8 flex flex-col gap-3">
          <UButton
            block
            size="lg"
            to="/login"
            :label="t('auth.forgot.backToLogin')"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="ghost"
            :label="t('auth.forgot.resend')"
            @click="resend"
          />
        </div>
      </MotionReveal>
    </template>
  </div>
</template>
