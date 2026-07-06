<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'guest', layout: 'auth' })

const { t } = useI18n()
const toast = useToast()

interface LoginForm {
  email: string
  password: string
}

const state = reactive<LoginForm>({ email: '', password: '' })
const loading = ref(false)

function validate(form: LoginForm): FormError[] {
  const errors: FormError[] = []
  if (!form.email) errors.push({ name: 'email', message: t('auth.errors.emailRequired') })
  if (!form.password) errors.push({ name: 'password', message: t('auth.errors.passwordRequired') })
  return errors
}

async function onSubmit(event: FormSubmitEvent<LoginForm>) {
  loading.value = true
  const { error } = await authClient.signIn.email(event.data)

  if (error) {
    loading.value = false
    toast.add({ title: t('auth.errors.signInFailed'), description: error.message, color: 'error' })
    return
  }

  await refreshAuthSession()
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="w-full max-w-sm">
    <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
      {{ t('auth.login.title') }}
    </h1>
    <p class="mt-2 text-sm text-muted">
      {{ t('auth.login.subtitle') }}
    </p>

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

      <UFormField
        :label="t('auth.fields.password')"
        name="password"
      >
        <UInput
          v-model="state.password"
          type="password"
          size="lg"
          autocomplete="current-password"
          :placeholder="t('auth.fields.passwordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        block
        size="lg"
        class="mt-1"
        :loading="loading"
        :label="t('auth.login.submit')"
      />
    </UForm>

    <USeparator class="my-8" />

    <p class="text-center text-sm text-muted">
      {{ t('auth.login.noAccount') }}
      <ULink
        to="/register"
        class="font-medium text-primary"
      >
        {{ t('auth.login.signUp') }}
      </ULink>
    </p>
  </div>
</template>
