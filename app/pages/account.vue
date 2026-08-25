<script setup lang="ts">
// The account surface: what a person may do with their own login, independent of
// any school. Carries only the `auth` middleware — no area guard — so it stays
// reachable for every signed-in user, including one whose membership is paused or
// whose school's subscription lapsed (both of those states are about a school, not
// about the account).
definePageMeta({ middleware: ['auth'], layout: 'dashboard' })

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const { data: session } = await useAuthSession()

const schemas = computed(() => accountFormSchemas(t))

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile = reactive({ name: '' })
const savingProfile = ref(false)

watch(session, (value) => {
  profile.name = value?.user.name ?? ''
}, { immediate: true })

const profileDirty = computed(() => profile.name.trim() !== (session.value?.user.name ?? ''))

async function onSaveProfile() {
  savingProfile.value = true
  const { error } = await authClient.updateUser({ name: profile.name.trim() })
  savingProfile.value = false

  if (error) {
    toastError('account.errors.saveFailed', error)
    return
  }

  await refreshAuthSession()
  toast.add({ title: t('account.saved'), color: 'success' })
}

// ─── Email ───────────────────────────────────────────────────────────────────

const emailForm = reactive({ email: '' })
const savingEmail = ref(false)

watch(session, (value) => {
  emailForm.email = value?.user.email ?? ''
}, { immediate: true })

const emailDirty = computed(() =>
  emailForm.email.trim().toLowerCase() !== (session.value?.user.email ?? '').toLowerCase()
)

async function onSaveEmail() {
  savingEmail.value = true
  const { error } = await authClient.changeEmail({ newEmail: emailForm.email.trim().toLowerCase() })
  savingEmail.value = false

  if (error) {
    toastError('account.errors.saveFailed', error)
    return
  }

  // Better Auth answers 200 without applying the change when the address already
  // belongs to another account (enumeration safety). Re-reading the session is
  // what keeps this honest: the field re-syncs from the stored address, so a
  // rejected change visibly snaps back instead of looking like it worked.
  await refreshAuthSession()
  toast.add({ title: t('account.email.updated'), color: 'success' })
}

// ─── Password ────────────────────────────────────────────────────────────────

const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const savingPassword = ref(false)

const passwordDirty = computed(() =>
  passwordForm.currentPassword.length > 0
  || passwordForm.newPassword.length > 0
  || passwordForm.confirmPassword.length > 0
)

function resetPasswordForm() {
  passwordForm.currentPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
}

async function onSavePassword() {
  savingPassword.value = true
  // revokeOtherSessions: a password change is how someone reacts to a suspected
  // compromise, so it must actually evict whoever else is signed in — not merely
  // change the secret. Better Auth issues this session a fresh token, so the
  // current device stays signed in.
  const { error } = await authClient.changePassword({
    currentPassword: passwordForm.currentPassword,
    newPassword: passwordForm.newPassword,
    revokeOtherSessions: true
  })
  savingPassword.value = false

  if (error) {
    toastError('account.errors.passwordFailed', error)
    return
  }

  resetPasswordForm()
  await Promise.all([refreshAuthSession(), refreshSessions()])
  toast.add({ title: t('account.password.updated'), color: 'success' })
}

// ─── Devices / active sessions ───────────────────────────────────────────────

// Keyed by user id, not a bare 'account:sessions': the Nuxt data cache is global,
// so a shared key would show the previous user their predecessor's device list
// (with IPs) after a sign-out/sign-in in the same tab — the same leak
// clearAppContext/clearNotificationsCache exist to prevent, avoided here by
// construction instead of by remembering to clear it.
const sessionsKey = `account:sessions:${session.value?.user.id ?? 'anonymous'}`

// Client-only: authClient calls don't carry the SSR request's cookies (the same
// reason session reads go through /api/session), so this would come back empty
// during render.
const { data: sessions, status: sessionsStatus, refresh: refreshSessions } = useAsyncData(
  sessionsKey,
  async () => {
    const { data, error } = await authClient.listSessions()
    if (error) {
      throw error
    }
    return data ?? []
  },
  { server: false }
)

const currentToken = computed(() => session.value?.session.token ?? null)

const deviceRows = computed(() => {
  const rows = (sessions.value ?? []).map(item => ({
    token: item.token,
    current: item.token === currentToken.value,
    label: formatDeviceLabel(item.userAgent) ?? t('account.devices.unknown'),
    ip: item.ipAddress || null,
    createdAt: item.createdAt
  }))
  // This device first, then newest — the list answers "what else is signed in?".
  return rows.sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
})

const otherDeviceCount = computed(() => deviceRows.value.filter(row => !row.current).length)

const revokingToken = ref<string | null>(null)

async function revokeDevice(token: string) {
  revokingToken.value = token
  const { error } = await authClient.revokeSession({ token })
  revokingToken.value = null

  if (error) {
    toastError('account.errors.revokeFailed', error)
    return
  }

  await refreshSessions()
  toast.add({ title: t('account.devices.revoked'), color: 'success' })
}

const revokingOthers = ref(false)

async function revokeOtherDevices() {
  revokingOthers.value = true
  const { error } = await authClient.revokeOtherSessions()
  revokingOthers.value = false

  if (error) {
    toastError('account.errors.revokeFailed', error)
    return
  }

  await refreshSessions()
  toast.add({ title: t('account.devices.revokedOthers'), color: 'success' })
}

// ─── Data export ─────────────────────────────────────────────────────────────

const exporting = ref(false)

async function onExport() {
  exporting.value = true
  try {
    // Fetched as a blob rather than navigating to the endpoint so a failure lands
    // in a localized toast instead of replacing the page with an error body.
    const blob = await $fetch<Blob>('/api/account/export', { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `courtto-account-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    toastError('account.errors.exportFailed', error)
  } finally {
    exporting.value = false
  }
}

// ─── Legal documents & consents ──────────────────────────────────────────────

const { data: legal, status: legalStatus, refresh: refreshLegal } = await useLazyFetch('/api/legal/state', {
  key: 'legal:state'
})

const acceptingLegal = ref(false)
const savingConsent = ref(false)

const marketingConsent = computed(() => legal.value?.consents.find(entry => entry.type === 'marketing') ?? null)

// Three distinct states, not two: "never asked" is deliberately not folded into
// "withdrawn" — both mean we may not send, but only one of them is a decision the
// person actually made.
const marketingStatusText = computed(() => {
  const entry = marketingConsent.value
  if (entry?.granted && entry.grantedAt) {
    return t('legal.account.marketingGranted', { date: formatDate(entry.grantedAt, locale.value) })
  }
  if (entry?.asked && entry.withdrawnAt) {
    return t('legal.account.marketingWithdrawn', { date: formatDate(entry.withdrawnAt, locale.value) })
  }
  return t('legal.account.marketingNever')
})

async function onAcceptLegal() {
  acceptingLegal.value = true
  try {
    await $fetch('/api/legal/accept', { method: 'POST' })
    await refreshLegal()
    toast.add({ title: t('legal.account.accepted'), color: 'success' })
  } catch (error) {
    toastError('account.errors.saveFailed', error)
  } finally {
    acceptingLegal.value = false
  }
}

// Withdrawal is one click and asks for nothing — art. 7(3) requires it to be as
// easy as giving consent, so there is no confirmation step in the way.
async function onSetMarketing(granted: boolean) {
  savingConsent.value = true
  try {
    await $fetch('/api/legal/consent/marketing', {
      method: 'PUT',
      body: { status: granted ? 'granted' : 'withdrawn' }
    })
    await refreshLegal()
    toast.add({ title: t('legal.account.consentSaved'), color: 'success' })
  } catch (error) {
    toastError('account.errors.saveFailed', error)
  } finally {
    savingConsent.value = false
  }
}

// ─── Delete account ──────────────────────────────────────────────────────────

const deleteOpen = ref(false)
const deletePassword = ref('')
const deleting = ref(false)

watch(deleteOpen, (open) => {
  if (!open) {
    deletePassword.value = ''
  }
})

async function onDelete() {
  if (deletePassword.value.length === 0) {
    return
  }

  deleting.value = true
  const { error } = await authClient.deleteUser({ password: deletePassword.value })
  deleting.value = false

  if (error) {
    // Includes the server-side guards: a stranded school (ACCOUNT_OWNS_SCHOOL) or
    // a wrong password, both localized from their stable code.
    toastError('account.errors.deleteFailed', error)
    return
  }

  deleteOpen.value = false
  // Same teardown as signing out — the globally-keyed caches would otherwise leak
  // the deleted user's context into the next session in this tab.
  clearAppContext()
  clearNotificationsCache()
  await refreshAuthSession()
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardPanel id="account">
    <template #header>
      <UDashboardNavbar :title="t('account.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-4xl px-1 py-2 lg:px-4">
        <MotionReveal>
          <p class="mb-10 max-w-2xl text-sm text-muted">
            {{ t('account.tagline') }}
          </p>
        </MotionReveal>

        <div class="flex flex-col gap-12">
          <!-- Profile -->
          <MotionReveal :delay="0.02">
            <SchoolSettingsCard
              id="profile"
              :title="t('account.profile.title')"
              :subtitle="t('account.profile.subtitle')"
              :state="profile"
              :schema="schemas.profile"
              :dirty="profileDirty"
              :saving="savingProfile"
              @submit="onSaveProfile"
              @discard="profile.name = session?.user.name ?? ''"
            >
              <UFormField
                :label="t('account.profile.name')"
                name="name"
              >
                <UInput
                  v-model="profile.name"
                  size="lg"
                  autocomplete="name"
                  class="w-full"
                />
              </UFormField>
            </SchoolSettingsCard>
          </MotionReveal>

          <!-- Email -->
          <MotionReveal :delay="0.06">
            <SchoolSettingsCard
              id="email"
              :title="t('account.email.title')"
              :subtitle="t('account.email.subtitle')"
              :state="emailForm"
              :schema="schemas.email"
              :dirty="emailDirty"
              :saving="savingEmail"
              @submit="onSaveEmail"
              @discard="emailForm.email = session?.user.email ?? ''"
            >
              <UFormField
                :label="t('account.email.label')"
                name="email"
                :help="t('account.email.help')"
              >
                <UInput
                  v-model="emailForm.email"
                  type="email"
                  size="lg"
                  icon="i-lucide-mail"
                  autocomplete="email"
                  class="w-full"
                />
              </UFormField>
            </SchoolSettingsCard>
          </MotionReveal>

          <!-- Password -->
          <MotionReveal :delay="0.1">
            <SchoolSettingsCard
              id="password"
              :title="t('account.password.title')"
              :subtitle="t('account.password.subtitle')"
              :state="passwordForm"
              :schema="schemas.password"
              :dirty="passwordDirty"
              :saving="savingPassword"
              :save-label="t('account.password.save')"
              @submit="onSavePassword"
              @discard="resetPasswordForm"
            >
              <UFormField
                :label="t('account.password.current')"
                name="currentPassword"
              >
                <UInput
                  v-model="passwordForm.currentPassword"
                  type="password"
                  size="lg"
                  autocomplete="current-password"
                  class="w-full"
                />
              </UFormField>
              <div class="grid gap-5 sm:grid-cols-2">
                <UFormField
                  :label="t('account.password.new')"
                  name="newPassword"
                  :help="t('account.password.hint', { min: MIN_PASSWORD_LENGTH })"
                >
                  <UInput
                    v-model="passwordForm.newPassword"
                    type="password"
                    size="lg"
                    autocomplete="new-password"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  :label="t('account.password.confirm')"
                  name="confirmPassword"
                >
                  <UInput
                    v-model="passwordForm.confirmPassword"
                    type="password"
                    size="lg"
                    autocomplete="new-password"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <p class="text-xs text-dimmed">
                {{ t('account.password.revokeNote') }}
              </p>
            </SchoolSettingsCard>
          </MotionReveal>

          <!-- Devices -->
          <MotionReveal :delay="0.14">
            <SchoolSettingsCard
              id="devices"
              :form="false"
              :title="t('account.devices.title')"
              :subtitle="t('account.devices.subtitle')"
            >
              <div
                v-if="sessionsStatus === 'pending'"
                class="flex flex-col gap-3"
              >
                <USkeleton
                  v-for="index in 2"
                  :key="index"
                  class="h-14 w-full"
                />
              </div>

              <p
                v-else-if="deviceRows.length === 0"
                class="text-sm text-muted"
              >
                {{ t('account.devices.empty') }}
              </p>

              <div
                v-else
                class="flex flex-col gap-3"
              >
                <div
                  v-for="row in deviceRows"
                  :key="row.token"
                  class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-elevated/40 px-4 py-3"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-monitor-smartphone"
                        class="size-4 shrink-0 text-dimmed"
                      />
                      <p class="truncate text-sm font-medium text-highlighted">
                        {{ row.label }}
                      </p>
                      <UBadge
                        v-if="row.current"
                        color="primary"
                        variant="subtle"
                        size="sm"
                        :label="t('account.devices.current')"
                      />
                    </div>
                    <p class="mt-0.5 text-xs text-muted">
                      {{ t('account.devices.signedIn', { date: formatDate(row.createdAt, locale) }) }}
                      <template v-if="row.ip">
                        · {{ row.ip }}
                      </template>
                    </p>
                  </div>
                  <UButton
                    v-if="!row.current"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-log-out"
                    :loading="revokingToken === row.token"
                    :label="t('account.devices.revoke')"
                    @click="revokeDevice(row.token)"
                  />
                </div>

                <div
                  v-if="otherDeviceCount > 0"
                  class="flex justify-end pt-1"
                >
                  <UButton
                    size="sm"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-shield-off"
                    :loading="revokingOthers"
                    :label="t('account.devices.revokeOthers', { count: otherDeviceCount })"
                    @click="revokeOtherDevices"
                  />
                </div>
              </div>
            </SchoolSettingsCard>
          </MotionReveal>

          <!-- Data & privacy -->
          <MotionReveal :delay="0.18">
            <SchoolSettingsCard
              id="data"
              :form="false"
              :title="t('account.data.title')"
              :subtitle="t('account.data.subtitle')"
            >
              <div class="flex flex-col gap-4">
                <p class="text-sm text-muted">
                  {{ t('account.data.includes') }}
                </p>
                <UAlert
                  icon="i-lucide-info"
                  color="neutral"
                  variant="subtle"
                  :description="t('account.data.controllerNote')"
                />
                <div class="flex justify-end">
                  <UButton
                    icon="i-lucide-download"
                    variant="subtle"
                    :loading="exporting"
                    :label="t('account.data.export')"
                    @click="onExport"
                  />
                </div>
              </div>
            </SchoolSettingsCard>
          </MotionReveal>

          <!-- Documents & consents -->
          <MotionReveal :delay="0.2">
            <SchoolSettingsCard
              id="legal"
              :form="false"
              :title="t('legal.account.title')"
              :subtitle="t('legal.account.description')"
            >
              <div class="flex flex-col gap-5">
                <div
                  v-if="legalStatus === 'pending'"
                  class="flex flex-col gap-3"
                >
                  <USkeleton class="h-14 w-full" />
                  <USkeleton class="h-14 w-full" />
                </div>

                <template v-else>
                  <div class="flex flex-col gap-3">
                    <div class="flex flex-wrap items-center gap-3">
                      <UButton
                        to="/terms"
                        target="_blank"
                        size="sm"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-file-text"
                        trailing-icon="i-lucide-external-link"
                        :label="t('legal.terms.title')"
                      />
                      <UButton
                        to="/privacy"
                        target="_blank"
                        size="sm"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-shield"
                        trailing-icon="i-lucide-external-link"
                        :label="t('legal.privacy.title')"
                      />
                    </div>

                    <p class="text-xs text-muted">
                      <template v-if="legal?.acceptance">
                        {{ t('legal.account.acceptedOn', { date: formatDate(legal.acceptance.acceptedAt, locale) }) }}
                      </template>
                      <template v-else>
                        {{ t('legal.account.neverAccepted') }}
                      </template>
                    </p>

                    <UAlert
                      v-if="legal?.needsReacceptance"
                      icon="i-lucide-file-clock"
                      color="warning"
                      variant="subtle"
                      :description="t('legal.account.outdated')"
                    >
                      <template #actions>
                        <UButton
                          size="sm"
                          color="warning"
                          variant="solid"
                          :loading="acceptingLegal"
                          :label="t('legal.account.acceptNow')"
                          @click="onAcceptLegal"
                        />
                      </template>
                    </UAlert>
                  </div>

                  <USeparator />

                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-highlighted">
                        {{ t('legal.account.marketingTitle') }}
                      </p>
                      <p class="mt-0.5 text-xs text-muted">
                        {{ t('legal.account.marketingDescription') }}
                      </p>
                      <p class="mt-1 text-xs text-dimmed">
                        {{ marketingStatusText }}
                      </p>
                    </div>
                    <UButton
                      size="sm"
                      color="neutral"
                      variant="subtle"
                      :icon="marketingConsent?.granted ? 'i-lucide-bell-off' : 'i-lucide-bell'"
                      :loading="savingConsent"
                      :label="marketingConsent?.granted ? t('legal.account.withdraw') : t('legal.account.grant')"
                      @click="onSetMarketing(!marketingConsent?.granted)"
                    />
                  </div>
                </template>
              </div>
            </SchoolSettingsCard>
          </MotionReveal>

          <!-- Danger zone -->
          <MotionReveal :delay="0.24">
            <SchoolSettingsCard
              id="danger"
              tone="danger"
              :form="false"
              :title="t('account.danger.title')"
              :subtitle="t('account.danger.subtitle')"
            >
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p class="max-w-md text-sm text-muted">
                  {{ t('account.danger.hint') }}
                </p>
                <UButton
                  color="error"
                  variant="subtle"
                  icon="i-lucide-trash-2"
                  :label="t('account.danger.delete')"
                  @click="deleteOpen = true"
                />
              </div>
            </SchoolSettingsCard>
          </MotionReveal>
        </div>
      </div>

      <UModal
        v-model:open="deleteOpen"
        :title="t('account.danger.confirmTitle')"
        :description="t('account.danger.confirmDescription')"
      >
        <template #body>
          <div class="flex flex-col gap-4">
            <UAlert
              icon="i-lucide-triangle-alert"
              color="error"
              variant="subtle"
              :description="t('account.danger.confirmWarning')"
            />
            <UFormField :label="t('account.danger.confirmLabel')">
              <UInput
                v-model="deletePassword"
                type="password"
                size="lg"
                autocomplete="current-password"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="deleteOpen = false"
            />
            <UButton
              color="error"
              :disabled="deletePassword.length === 0"
              :loading="deleting"
              :label="t('account.danger.delete')"
              @click="onDelete"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
