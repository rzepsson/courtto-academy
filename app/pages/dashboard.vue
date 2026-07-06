<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { t } = useI18n()
const { data: session } = await useAuthSession()
const loading = ref(false)

async function onSignOut() {
  loading.value = true
  await authClient.signOut()
  await refreshAuthSession()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-xl font-semibold text-highlighted">
          {{ t('dashboard.title') }}
        </h1>
        <p class="mt-1 text-sm text-muted">
          {{ t('dashboard.welcome', { name: session?.user.name }) }}
        </p>
      </template>

      <dl class="flex flex-col gap-3 text-sm">
        <div class="flex items-center justify-between gap-4">
          <dt class="text-muted">
            {{ t('auth.fields.name') }}
          </dt>
          <dd class="font-medium text-highlighted">
            {{ session?.user.name }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-4">
          <dt class="text-muted">
            {{ t('auth.fields.email') }}
          </dt>
          <dd class="font-medium text-highlighted">
            {{ session?.user.email }}
          </dd>
        </div>
      </dl>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-log-out"
          :loading="loading"
          :label="t('auth.signOut')"
          @click="onSignOut"
        />
      </template>
    </UCard>
  </div>
</template>
