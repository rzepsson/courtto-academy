<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { t, locale } = useI18n()
const toast = useToast()
const route = useRoute()

const invitationId = computed(() => String(route.params.id))

// Fire both requests together — they're independent and the invite page has no
// middleware to pre-warm the session cache.
const invitationFetch = useFetch(
  () => `/api/invitations/${invitationId.value}`,
  { key: () => `invitation:${invitationId.value}` }
)
const sessionFetch = useAuthSession()
await Promise.all([invitationFetch, sessionFetch])

const { data: invitation, error: loadError } = invitationFetch
const { data: session } = sessionFetch

const isPending = computed(() => invitation.value?.status === 'pending')

const statusKey = computed(() => {
  if (loadError.value || !invitation.value) return 'notFound'
  if (invitation.value.status === 'pending') return null
  return invitation.value.status
})

const expiresAtLabel = computed(() =>
  invitation.value ? formatDate(invitation.value.expiresAt, locale.value, 'long') : ''
)

const authQuery = computed(() => ({ redirect: `/invite/${invitationId.value}` }))

const accepting = ref(false)
const declining = ref(false)

async function onAccept() {
  if (!invitation.value) return

  accepting.value = true
  const { error } = await authClient.organization.acceptInvitation({ invitationId: invitationId.value })

  if (error) {
    accepting.value = false
    toast.add({ title: t('invite.errors.acceptFailed'), description: error.message, color: 'error' })
    return
  }

  await authClient.organization.setActive({ organizationId: invitation.value.organization.id })
  await Promise.all([refreshAuthSession(), refreshAppContext()])
  toast.add({ title: t('invite.accepted', { school: invitation.value.organization.name }), color: 'success' })
  await navigateTo(roleHome(invitation.value.role))
}

async function onDecline() {
  declining.value = true
  const { error } = await authClient.organization.rejectInvitation({ invitationId: invitationId.value })

  if (error) {
    declining.value = false
    toast.add({ title: t('invite.errors.declineFailed'), description: error.message, color: 'error' })
    return
  }

  toast.add({ title: t('invite.declined'), color: 'neutral' })
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="w-full">
    <template v-if="invitation && isPending">
      <div class="flex flex-col items-center text-center">
        <UAvatar
          :src="invitation.organization.logo ?? undefined"
          :alt="invitation.organization.name"
          size="3xl"
        />
        <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
          {{ t('invite.title', { school: invitation.organization.name }) }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          {{ t('invite.subtitle', { inviter: invitation.inviterName }) }}
        </p>
        <RoleBadge
          :role="invitation.role"
          size="md"
          class="mt-4"
        />
      </div>

      <dl class="mt-8 flex flex-col gap-3 text-sm">
        <div class="flex items-center justify-between gap-4">
          <dt class="text-muted">
            {{ t('invite.sentTo') }}
          </dt>
          <dd class="font-medium text-highlighted">
            {{ invitation.maskedEmail }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-4">
          <dt class="text-muted">
            {{ t('invite.validUntil') }}
          </dt>
          <dd class="font-medium text-highlighted">
            {{ expiresAtLabel }}
          </dd>
        </div>
      </dl>

      <template v-if="session">
        <div class="mt-8 flex flex-col gap-3">
          <PressButton
            trailing-icon="i-lucide-arrow-right"
            :loading="accepting"
            :disabled="declining"
            :label="t('invite.accept')"
            @click="onAccept"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="ghost"
            :loading="declining"
            :disabled="accepting"
            :label="t('invite.decline')"
            @click="onDecline"
          />
        </div>
        <p class="mt-6 text-center text-xs text-dimmed">
          {{ t('invite.signedInAs', { email: session.user.email }) }}
        </p>
      </template>

      <template v-else>
        <div class="mt-8 flex flex-col gap-3">
          <UButton
            block
            size="lg"
            :to="{ path: '/register', query: authQuery }"
            :label="t('invite.createAccount')"
          />
          <UButton
            block
            size="lg"
            color="neutral"
            variant="subtle"
            :to="{ path: '/login', query: authQuery }"
            :label="t('invite.signIn')"
          />
        </div>
        <p class="mt-6 text-center text-xs text-dimmed">
          {{ t('invite.emailHint') }}
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
          {{ t(`invite.status.${statusKey}.title`) }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          {{ t(`invite.status.${statusKey}.description`) }}
        </p>
        <UButton
          class="mt-8"
          size="lg"
          :to="session ? '/dashboard' : '/login'"
          :label="session ? t('invite.backToDashboard') : t('invite.signIn')"
        />
      </div>
    </template>
  </div>
</template>
