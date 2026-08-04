<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

// No guest/auth middleware on purpose: a reset link must open regardless of
// session (a signed-in user can reset too), and `guest` would bounce them away.
definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const route = useRoute()

// Better Auth's /reset-password/:token callback validates the token first, then
// redirects here with either ?token=<valid> or ?error=INVALID_TOKEN — so a bad or
// expired link is caught before the user ever types a new password.
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : null))
const linkError = computed(() => (typeof route.query.error === 'string' ? route.query.error : null))
const invalid = computed(() => !token.value || linkError.value !== null)

interface ResetForm {
  password: string
  confirm: string
}

const state = reactive<ResetForm>({ password: '', confirm: '' })
const loading = ref(false)
const showPassword = ref(false)

function validate(form: ResetForm): FormError[] {
  const errors: FormError[] = []
  if (!form.password) errors.push({ name: 'password', message: t('auth.errors.passwordRequired') })
  else if (form.password.length < 8) errors.push({ name: 'password', message: t('auth.errors.passwordTooShort') })
  if (!form.confirm) errors.push({ name: 'confirm', message: t('auth.errors.confirmRequired') })
  else if (form.confirm !== form.password) errors.push({ name: 'confirm', message: t('auth.errors.passwordMismatch') })
  return errors
}

async function onSubmit(event: FormSubmitEvent<ResetForm>) {
  if (!token.value) return

  loading.value = true
  const { error } = await authClient.resetPassword({ newPassword: event.data.password, token: token.value })
  loading.value = false

  if (error) {
    toastError('auth.errors.resetFailed', error)
    return
  }

  toast.add({ title: t('auth.reset.success'), color: 'success' })
  await navigateTo('/login')
}
</script>

<template>
  <div class="w-full">
    <template v-if="!invalid">
      <MotionReveal :y="8">
        <div class="text-center">
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
            {{ t('auth.reset.title') }}
          </h1>
          <p class="mt-2 text-sm text-muted">
            {{ t('auth.reset.subtitle') }}
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
            :label="t('auth.reset.newPassword')"
            name="password"
          >
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              size="lg"
              autocomplete="new-password"
              :placeholder="t('auth.fields.passwordPlaceholder')"
              class="w-full"
              :ui="{ trailing: 'pe-1' }"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="showPassword ? t('auth.fields.hidePassword') : t('auth.fields.showPassword')"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <UFormField
            :label="t('auth.reset.confirmPassword')"
            name="confirm"
          >
            <UInput
              v-model="state.confirm"
              :type="showPassword ? 'text' : 'password'"
              size="lg"
              autocomplete="new-password"
              :placeholder="t('auth.fields.passwordPlaceholder')"
              class="w-full"
            />
          </UFormField>

          <PressButton
            type="submit"
            class="mt-1"
            trailing-icon="i-lucide-arrow-right"
            :loading="loading"
            :label="t('auth.reset.submit')"
          />
        </UForm>
      </MotionReveal>
    </template>

    <template v-else>
      <MotionReveal :y="8">
        <div class="flex flex-col items-center text-center">
          <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
            <UIcon
              name="i-lucide-link-2-off"
              class="size-7 text-dimmed"
            />
          </div>
          <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
            {{ t('auth.reset.invalidTitle') }}
          </h1>
          <p class="mt-2 text-sm text-muted">
            {{ t('auth.reset.invalidDescription') }}
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
            to="/forgot-password"
            :label="t('auth.reset.requestNew')"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="ghost"
            to="/login"
            :label="t('auth.forgot.backToLogin')"
          />
        </div>
      </MotionReveal>
    </template>
  </div>
</template>
