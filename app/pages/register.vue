<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'guest', layout: 'auth' })

const { t } = useI18n()
const { toastError } = useApiError()
const route = useRoute()

const redirectTarget = computed(() => sanitizeRedirect(route.query.redirect))
const crossQuery = computed(() =>
  typeof route.query.redirect === 'string' ? { redirect: route.query.redirect } : undefined
)

interface RegisterForm {
  name: string
  email: string
  password: string
  // Accepting the terms is required — it is how the contract is concluded. The
  // marketing consent beside it is deliberately separate, optional and unticked:
  // a consent bundled with a mandatory acceptance is not freely given, and so is
  // not a consent at all.
  acceptTerms: boolean
  marketing: boolean
}

const state = reactive<RegisterForm>({
  name: '',
  email: '',
  password: '',
  acceptTerms: false,
  marketing: false
})
const loading = ref(false)
const showPassword = ref(false)

function validate(form: RegisterForm): FormError[] {
  const errors: FormError[] = []
  if (!form.name) errors.push({ name: 'name', message: t('auth.errors.nameRequired') })
  if (!form.email) errors.push({ name: 'email', message: t('auth.errors.emailRequired') })
  if (!form.password) errors.push({ name: 'password', message: t('auth.errors.passwordRequired') })
  else if (form.password.length < 8) errors.push({ name: 'password', message: t('auth.errors.passwordTooShort') })
  if (!form.acceptTerms) errors.push({ name: 'acceptTerms', message: t('auth.errors.termsRequired') })
  return errors
}

async function onSubmit(event: FormSubmitEvent<RegisterForm>) {
  loading.value = true

  // Only the credential fields go to Better Auth. The acceptance itself is
  // recorded server-side from the user-created hook, at the versions the server
  // is actually serving — a version the browser claims to have read would not be
  // evidence of anything.
  const { name, email, password, marketing } = event.data
  const { error } = await authClient.signUp.email({ name, email, password })

  if (error) {
    loading.value = false
    toastError('auth.errors.signUpFailed', error)
    return
  }

  // Optional, and it needs the session that sign-up just created. Best-effort by
  // design: if it fails, no consent is stored, and no consent means no marketing —
  // the failure direction that cannot cause an unlawful send.
  if (marketing) {
    await $fetch('/api/legal/consent/marketing', {
      method: 'PUT',
      body: { status: 'granted' }
    }).catch(() => undefined)
  }

  clearAppContext()
  await refreshAuthSession()
  await navigateTo(redirectTarget.value)
}
</script>

<template>
  <div class="w-full">
    <MotionReveal :y="8">
      <div class="text-center">
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
          {{ t('auth.register.title') }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          {{ t('auth.register.subtitle') }}
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
          :label="t('auth.fields.name')"
          name="name"
        >
          <UInput
            v-model="state.name"
            size="lg"
            autocomplete="name"
            :placeholder="t('auth.fields.namePlaceholder')"
            class="w-full"
          />
        </UFormField>

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

        <UFormField
          :label="t('auth.fields.password')"
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

        <div class="flex flex-col gap-3">
          <UFormField name="acceptTerms">
            <UCheckbox
              v-model="state.acceptTerms"
              :aria-label="t('legal.accept.aria')"
            >
              <template #label>
                <span class="text-sm text-muted">
                  <i18n-t
                    keypath="legal.accept.label"
                    scope="global"
                  >
                    <template #terms>
                      <ULink
                        to="/terms"
                        target="_blank"
                        class="font-medium text-primary"
                      >{{ t('legal.accept.termsLink') }}</ULink>
                    </template>
                    <template #privacy>
                      <ULink
                        to="/privacy"
                        target="_blank"
                        class="font-medium text-primary"
                      >{{ t('legal.accept.privacyLink') }}</ULink>
                    </template>
                  </i18n-t>
                </span>
              </template>
            </UCheckbox>
          </UFormField>

          <UCheckbox
            v-model="state.marketing"
            :label="t('legal.accept.marketing')"
            :ui="{ label: 'text-sm text-muted' }"
          />
        </div>

        <PressButton
          type="submit"
          class="mt-1"
          trailing-icon="i-lucide-arrow-right"
          :loading="loading"
          :label="t('auth.register.submit')"
        />
      </UForm>
    </MotionReveal>

    <MotionReveal
      :y="8"
      :delay="0.16"
    >
      <USeparator class="my-8" />

      <p class="text-center text-sm text-muted">
        {{ t('auth.register.hasAccount') }}
        <ULink
          :to="{ path: '/login', query: crossQuery }"
          class="font-medium text-primary"
        >
          {{ t('auth.register.signIn') }}
        </ULink>
      </p>
    </MotionReveal>
  </div>
</template>
