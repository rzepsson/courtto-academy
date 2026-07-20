<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const { copiedId, copy: copyInviteLink } = useInviteLink()
const { data: session } = await useAuthSession()
const origin = useRequestURL().origin

// Lazy so the page shell renders instantly on navigation; lists fill via skeletons.
// The members list itself is the self-contained <SchoolMembersDirectory> (its own
// paginated fetch); this page owns only the join code + invitations sections.
const { data: invitations, status: invitationsStatus, refresh: refreshInvitations } = useLazyFetch('/api/school/invitations', { key: 'school:invitations' })
const { data: joinCodeData, status: joinCodeStatus, refresh: refreshJoinCode } = useLazyFetch('/api/school/join-code', { key: 'school:joinCode' })

const invitationsLoading = computed(() => invitationsStatus.value === 'pending')
const joinCodeLoading = computed(() => joinCodeStatus.value === 'pending')

const inviteOpen = ref(false)

const joinCode = computed(() => joinCodeData.value?.joinCode ?? null)
const joinLink = computed(() => joinCode.value ? `${origin}/join/${joinCode.value.code}` : '')

const { copiedKey, copy } = useClipboard()
const rotating = ref(false)
const togglingEnabled = ref(false)
const regenerateOpen = ref(false)

async function toggleEnabled(enabled: boolean) {
  togglingEnabled.value = true
  try {
    await $fetch('/api/school/join-code', { method: 'PATCH', body: { enabled } })
    await refreshJoinCode()
  } catch {
    toast.add({ title: t('school.joinCode.errors.toggleFailed'), color: 'error' })
  } finally {
    togglingEnabled.value = false
  }
}

async function generateCode() {
  rotating.value = true
  try {
    await $fetch('/api/school/join-code', { method: 'POST' })
    await refreshJoinCode()
    toast.add({ title: t('school.joinCode.generated'), color: 'success' })
  } catch {
    toast.add({ title: t('school.joinCode.errors.rotateFailed'), color: 'error' })
  } finally {
    rotating.value = false
    regenerateOpen.value = false
  }
}

function copyCode() {
  if (joinCode.value) {
    copy('code', formatJoinCode(joinCode.value.code))
  }
}

function copyJoinLink() {
  if (joinCode.value) {
    copy('link', joinLink.value)
  }
}

async function cancelInvitation(invitationId: string) {
  const { error } = await authClient.organization.cancelInvitation({ invitationId })

  if (error) {
    toastError('school.invitations.errors.cancelFailed', error)
    return
  }

  toast.add({ title: t('school.invitations.canceled'), color: 'neutral' })
  await refreshInvitations()
}

function dateLabel(value: string) {
  return formatDate(value, locale.value)
}
</script>

<template>
  <UDashboardPanel id="school-members">
    <template #header>
      <UDashboardNavbar :title="t('nav.members')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <AppHeaderControls />
          <PressButton
            :block="false"
            size="md"
            icon="i-lucide-user-plus"
            :label="t('school.members.invite')"
            @click="inviteOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-8">
        <MotionReveal>
          <UCard variant="subtle">
            <template #header>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h2 class="font-semibold text-highlighted">
                    {{ t('school.joinCode.title') }}
                  </h2>
                  <p class="mt-1 text-sm text-muted">
                    {{ t('school.joinCode.subtitle') }}
                  </p>
                </div>
                <USwitch
                  v-if="joinCode"
                  :model-value="joinCode.enabled"
                  :disabled="togglingEnabled"
                  :label="t('school.joinCode.toggleLabel')"
                  class="shrink-0"
                  @update:model-value="toggleEnabled"
                />
                <UIcon
                  v-else-if="!joinCodeLoading"
                  name="i-lucide-ticket"
                  class="hidden size-5 shrink-0 text-dimmed sm:block"
                />
              </div>
            </template>

            <USkeleton
              v-if="joinCodeLoading"
              class="h-20 w-full"
            />

            <div
              v-else-if="joinCode && joinCode.enabled"
              class="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex flex-col items-center rounded-xl bg-elevated/40 px-6 py-4 ring-1 ring-default sm:items-start">
                <span class="font-mono text-3xl font-semibold tracking-[0.25em] text-highlighted">
                  {{ formatJoinCode(joinCode.code) }}
                </span>
                <span class="mt-1.5 text-xs text-dimmed">
                  {{ t('school.joinCode.expires', { date: dateLabel(joinCode.expiresAt) }) }}
                </span>
              </div>
              <div class="flex flex-wrap gap-2">
                <PressButton
                  :block="false"
                  size="md"
                  :icon="copiedKey === 'code' ? 'i-lucide-check' : 'i-lucide-copy'"
                  :label="copiedKey === 'code' ? t('common.copied') : t('school.joinCode.copyCode')"
                  @click="copyCode"
                />
                <UButton
                  color="neutral"
                  variant="subtle"
                  size="md"
                  :icon="copiedKey === 'link' ? 'i-lucide-check' : 'i-lucide-link'"
                  :label="copiedKey === 'link' ? t('common.copied') : t('school.joinCode.copyLink')"
                  @click="copyJoinLink"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="md"
                  icon="i-lucide-refresh-cw"
                  :label="t('school.joinCode.regenerate')"
                  :loading="rotating"
                  @click="regenerateOpen = true"
                />
              </div>
            </div>

            <div
              v-else-if="joinCode"
              class="flex items-center gap-3 rounded-xl bg-elevated/40 px-4 py-3 ring-1 ring-default"
            >
              <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated">
                <UIcon
                  name="i-lucide-pause"
                  class="size-4 text-dimmed"
                />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">
                  {{ t('school.joinCode.off.title') }}
                </p>
                <p class="mt-0.5 text-sm text-muted">
                  {{ t('school.joinCode.off.description') }}
                </p>
              </div>
            </div>

            <div
              v-else
              class="flex flex-col items-center py-6 text-center"
            >
              <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
                <UIcon
                  name="i-lucide-ticket"
                  class="size-6 text-dimmed"
                />
              </div>
              <p class="mt-3 text-sm font-medium text-highlighted">
                {{ t('school.joinCode.empty.title') }}
              </p>
              <p class="mt-1 max-w-sm text-sm text-muted">
                {{ t('school.joinCode.empty.description') }}
              </p>
              <PressButton
                class="mt-4"
                :block="false"
                size="md"
                icon="i-lucide-sparkles"
                :label="t('school.joinCode.generate')"
                :loading="rotating"
                @click="generateCode"
              />
            </div>
          </UCard>
        </MotionReveal>

        <MotionReveal :delay="0.1">
          <SchoolMembersDirectory :current-user-id="session?.user.id" />
        </MotionReveal>

        <MotionReveal :delay="0.2">
          <UCard variant="subtle">
            <template #header>
              <div class="flex items-center gap-2.5">
                <h2 class="font-semibold text-highlighted">
                  {{ t('school.invitations.title') }}
                </h2>
                <UBadge
                  v-if="!invitationsLoading && (invitations?.length ?? 0) > 0"
                  :label="String(invitations?.length ?? 0)"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="mt-1 text-sm text-muted">
                {{ t('school.invitations.subtitle') }}
              </p>
            </template>

            <AppListSkeleton
              v-if="invitationsLoading"
              :rows="2"
            />
            <ul
              v-else-if="(invitations?.length ?? 0) > 0"
              class="flex flex-col divide-y divide-default/60"
            >
              <li
                v-for="invite in invitations ?? []"
                :key="invite.id"
                class="group -mx-2 flex flex-wrap items-center justify-between gap-4 rounded-lg px-3 py-3 transition-colors first:pt-3 last:pb-3 hover:bg-elevated/50"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
                    <UIcon
                      name="i-lucide-mail"
                      class="size-4 text-dimmed"
                    />
                  </div>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ invite.email }}
                    </p>
                    <p class="mt-0.5 flex items-center gap-1 text-xs text-dimmed">
                      <UIcon
                        name="i-lucide-clock-3"
                        class="size-3 shrink-0"
                      />
                      {{ t('school.invitations.expires', { date: dateLabel(invite.expiresAt) }) }}
                    </p>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <RoleBadge :role="invite.role" />
                  <UButton
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    :icon="copiedId === invite.id ? 'i-lucide-check' : 'i-lucide-copy'"
                    :label="copiedId === invite.id ? t('common.copied') : t('school.invitations.copyLink')"
                    @click="copyInviteLink(invite.id)"
                  />
                  <UButton
                    color="error"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-x"
                    :aria-label="t('school.invitations.cancel')"
                    @click="cancelInvitation(invite.id)"
                  />
                </div>
              </li>
            </ul>

            <div
              v-else
              class="flex flex-col items-center py-6 text-center"
            >
              <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
                <UIcon
                  name="i-lucide-mail-plus"
                  class="size-6 text-dimmed"
                />
              </div>
              <p class="mt-3 text-sm font-medium text-highlighted">
                {{ t('school.invitations.empty.title') }}
              </p>
              <p class="mt-1 max-w-sm text-sm text-muted">
                {{ t('school.invitations.empty.description') }}
              </p>
              <PressButton
                class="mt-4"
                :block="false"
                size="md"
                variant="subtle"
                icon="i-lucide-user-plus"
                :label="t('school.members.invite')"
                @click="inviteOpen = true"
              />
            </div>
          </UCard>
        </MotionReveal>
      </div>

      <SchoolInviteMemberModal
        v-model:open="inviteOpen"
        @created="refreshInvitations()"
      />

      <UModal
        :open="regenerateOpen"
        :title="t('school.joinCode.regenerateConfirm.title')"
        :description="t('school.joinCode.regenerateConfirm.description')"
        @update:open="(value: boolean) => { if (!value) regenerateOpen = false }"
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="regenerateOpen = false"
            />
            <UButton
              :loading="rotating"
              :label="t('school.joinCode.regenerate')"
              @click="generateCode"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
