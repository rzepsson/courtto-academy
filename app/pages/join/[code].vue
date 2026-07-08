<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const toast = useToast()
const route = useRoute()

const code = computed(() => String(route.params.code))

// Preview and session are independent; fetch together — the join page has no
// middleware to pre-warm the session cache.
const previewFetch = useFetch(
  () => `/api/join/${code.value}`,
  { key: () => `join:${code.value}` }
)
const sessionFetch = useAuthSession()
await Promise.all([previewFetch, sessionFetch])

const { data: preview, error: loadError } = previewFetch
const { data: session } = sessionFetch

const organization = computed(() => preview.value?.organization ?? null)
const authQuery = computed(() => ({ redirect: `/join/${code.value}` }))

const joining = ref(false)

async function onJoin() {
  joining.value = true
  try {
    const { organization: joined } = await $fetch('/api/join', {
      method: 'POST',
      body: { code: code.value }
    })

    await authClient.organization.setActive({ organizationId: joined.id })
    await Promise.all([refreshAuthSession(), refreshAppContext()])
    toast.add({ title: t('join.joined', { school: joined.name }), color: 'success' })
    await navigateTo(roleHome('student'))
  } catch {
    joining.value = false
    toast.add({ title: t('join.errors.joinFailed'), color: 'error' })
  }
}
</script>

<template>
  <div class="w-full">
    <template v-if="organization && !loadError">
      <div class="flex flex-col items-center text-center">
        <UAvatar
          :src="organization.logo ?? undefined"
          :alt="organization.name"
          size="3xl"
        />
        <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
          {{ t('join.confirmTitle', { school: organization.name }) }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          {{ t('join.confirmSubtitle') }}
        </p>
        <RoleBadge
          role="student"
          size="md"
          class="mt-4"
        />
      </div>

      <template v-if="session">
        <div class="mt-8 flex flex-col gap-3">
          <PressButton
            trailing-icon="i-lucide-arrow-right"
            :loading="joining"
            :label="t('join.join')"
            @click="onJoin"
          />
        </div>
        <p class="mt-6 text-center text-xs text-dimmed">
          {{ t('join.signedInAs', { email: session.user.email }) }}
        </p>
      </template>

      <template v-else>
        <div class="mt-8 flex flex-col gap-3">
          <UButton
            block
            size="lg"
            :to="{ path: '/register', query: authQuery }"
            :label="t('join.createAccount')"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="subtle"
            :to="{ path: '/login', query: authQuery }"
            :label="t('join.signIn')"
          />
        </div>
        <p class="mt-6 text-center text-xs text-dimmed">
          {{ t('join.roleNote') }}
        </p>
      </template>
    </template>

    <template v-else>
      <div class="flex flex-col items-center text-center">
        <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
          <UIcon
            name="i-lucide-ticket-x"
            class="size-7 text-dimmed"
          />
        </div>
        <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
          {{ t('join.invalid.title') }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          {{ t('join.invalid.description') }}
        </p>
        <UButton
          class="mt-8"
          size="lg"
          to="/join"
          :label="t('join.tryAnother')"
        />
      </div>
    </template>
  </div>
</template>
