<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'guest', layout: 'auth' })

const { t } = useI18n()
const toast = useToast()

interface RegisterForm {
  name: string
  email: string
  password: string
}

const state = reactive<RegisterForm>({ name: '', email: '', password: '' })
const loading = ref(false)

function validate(form: RegisterForm): FormError[] {
  const errors: FormError[] = []
  if (!form.name) errors.push({ name: 'name', message: t('auth.errors.nameRequired') })
  if (!form.email) errors.push({ name: 'email', message: t('auth.errors.emailRequired') })
  if (!form.password) errors.push({ name: 'password', message: t('auth.errors.passwordRequired') })
  else if (form.password.length < 8) errors.push({ name: 'password', message: t('auth.errors.passwordTooShort') })
  return errors
}

async function onSubmit(event: FormSubmitEvent<RegisterForm>) {
  loading.value = true
  const { error } = await authClient.signUp.email(event.data)

  if (error) {
    loading.value = false
    toast.add({ title: t('auth.errors.signUpFailed'), description: error.message, color: 'error' })
    return
  }

  await refreshAuthSession()
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="w-full max-w-sm">
    <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
      {{ t('auth.register.title') }}
    </h1>
    <p class="mt-2 text-sm text-muted">
      {{ t('auth.register.subtitle') }}
    </p>

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
          type="password"
          size="lg"
          autocomplete="new-password"
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
        :label="t('auth.register.submit')"
      />
    </UForm>

    <USeparator class="my-8" />

    <p class="text-center text-sm text-muted">
      {{ t('auth.register.hasAccount') }}
      <ULink
        to="/login"
        class="font-medium text-primary"
      >
        {{ t('auth.register.signIn') }}
      </ULink>
    </p>
  </div>
</template>
