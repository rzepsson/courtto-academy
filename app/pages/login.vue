<script setup lang="ts">
import { motion } from 'motion-v'
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'guest' })

const { t } = useI18n()
const toast = useToast()
const { card, item } = useAuthMotion()

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
  <div class="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
    <motion.div
      class="w-full max-w-sm"
      :initial="card.initial"
      :animate="card.animate"
      :transition="card.transition"
    >
      <UCard>
        <template #header>
          <h1 class="text-xl font-semibold text-highlighted">
            {{ t('auth.login.title') }}
          </h1>
          <p class="mt-1 text-sm text-muted">
            {{ t('auth.login.subtitle') }}
          </p>
        </template>

        <UForm
          :state="state"
          :validate="validate"
          class="flex flex-col gap-4"
          @submit="onSubmit"
        >
          <motion.div v-bind="item(0)">
            <UFormField
              :label="t('auth.fields.email')"
              name="email"
            >
              <UInput
                v-model="state.email"
                type="email"
                autocomplete="email"
                :placeholder="t('auth.fields.emailPlaceholder')"
                class="w-full"
              />
            </UFormField>
          </motion.div>

          <motion.div v-bind="item(1)">
            <UFormField
              :label="t('auth.fields.password')"
              name="password"
            >
              <UInput
                v-model="state.password"
                type="password"
                autocomplete="current-password"
                :placeholder="t('auth.fields.passwordPlaceholder')"
                class="w-full"
              />
            </UFormField>
          </motion.div>

          <motion.div
            v-bind="item(2)"
            :while-press="{ scale: 0.98 }"
          >
            <UButton
              type="submit"
              block
              :loading="loading"
              :label="t('auth.login.submit')"
            />
          </motion.div>
        </UForm>

        <template #footer>
          <p class="text-sm text-muted">
            {{ t('auth.login.noAccount') }}
            <ULink
              to="/register"
              class="text-primary font-medium"
            >
              {{ t('auth.login.signUp') }}
            </ULink>
          </p>
        </template>
      </UCard>
    </motion.div>

    <LocaleSwitcher />
  </div>
</template>
